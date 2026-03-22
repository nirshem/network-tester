import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import asyncio
import subprocess
import os
import re
import shlex
import signal

from typing import Any
from contextlib import asynccontextmanager

processes: dict[str, Any] = {
    "server": None,
    "client": None,
    "ping": None
}

async def cleanup_processes():
    # Stop any running processes managed by this app
    for p_name, p in processes.items():
        if p and p.returncode is None:
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            except:
                try:
                    p.terminate()
                except:
                    pass
    
    # Stop any external iperf3 and ping processes
    try:
        subprocess.run(["pkill", "-9", "-f", "iperf3"], capture_output=True)
        subprocess.run(["pkill", "-9", "-f", "ping.*127.0.0.1"], capture_output=True)
    except Exception:
        pass
    
    # Small delay for the OS to release resources
    await asyncio.sleep(2.0)

@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    await cleanup_processes()
    yield

app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory="static"), name="static")

class ServerConfig(BaseModel):
    port: int
    interval: float = 0.1

class ClientConfig(BaseModel):
    host: str
    port: int
    protocol: str
    bandwidth: str
    duration: float
    interval: float = 0.1
    parallel: int = 1
    zerocopy: bool = False
    length: int = 1470

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# Handled by moving to top

def parse_iperf_metrics(line):
    metric_data = {}
    
    # Parse time range
    time_match = re.search(r'\[\s*\d+\]\s+([\d\.]+)-([\d\.]+)\s+sec', line)
    if time_match:
        metric_data["time"] = float(time_match.group(2))

    match_tp = re.search(r'(\d+(?:\.\d+)?)\s+(Kbits/sec|Mbits/sec|Gbits/sec)', line)
    if match_tp:
        val = float(match_tp.group(1))
        unit = match_tp.group(2)
        if unit == 'Kbits/sec': val /= 1000
        elif unit == 'Gbits/sec': val *= 1000
        metric_data["throughput"] = val

    match_jitter = re.search(r'(\d+(?:\.\d+)?)\s+ms', line)
    if match_jitter and 'ms' in line and ('/' in line or '%' in line):
        metric_data["jitter"] = float(match_jitter.group(1))

    return metric_data

def parse_ping_latency(line):
    match = re.search(r'time=([\d\.]+)\s*ms', line)
    if match:
        return float(match.group(1))
    return None

async def read_stream_and_broadcast(stream, source_type, parse_type="iperf", start_time=None):
    while True:
        try:
            line = await stream.readline()
            if not line:
                break
            
            decoded_line = line.decode('utf-8').strip()
            if not decoded_line:
                continue

            await manager.broadcast({"source": source_type, "type": "log", "data": decoded_line})
            
            if parse_type == "iperf":
                metrics = parse_iperf_metrics(decoded_line)
                if metrics:
                    # Send to both charts to ensure full visibility
                    await manager.broadcast({"source": "server", "type": "metric", "data": metrics})
                    await manager.broadcast({"source": "client", "type": "metric", "data": metrics})
                    
            elif parse_type == "ping":
                latency = parse_ping_latency(decoded_line)
                if latency is not None:
                    elapsed = 0
                    if start_time:
                        elapsed = int(asyncio.get_event_loop().time() - start_time)
                    # Send to both charts
                    await manager.broadcast({"source": "server", "type": "metric", "data": {"latency": latency, "time": elapsed}})
                    await manager.broadcast({"source": "client", "type": "metric", "data": {"latency": latency, "time": elapsed}})
        except asyncio.CancelledError:
            break
        except Exception:
            pass

async def run_process(cmd, source_type, parse_type="iperf"):
    try:
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid
        )
        
        if parse_type == "ping":
            processes["ping"] = process
        else:
            processes[source_type] = process
            
        await manager.broadcast({"source": source_type, "type": "status", "data": f"Started {cmd}"})
        
        start_time = asyncio.get_event_loop().time()
        await read_stream_and_broadcast(process.stdout, source_type, parse_type, start_time)
        
        await process.wait()
        await manager.broadcast({"source": source_type, "type": "status", "data": "ended"})
    except Exception as e:
        await manager.broadcast({"source": source_type, "type": "log", "data": f"Error: {e}"})

@app.get("/")
async def get():
    with open("static/index.html") as f:
        return HTMLResponse(f.read())

@app.get("/api/ip")
async def get_ip():
    try:
        # Try to find a wireless interface (starting with wlan or wlp)
        cmd = "ip -4 -o addr show | grep -E 'wlan|wlp' | awk '{print $4}' | cut -d/ -f1"
        proc = await asyncio.create_subprocess_shell(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, _ = await proc.communicate()
        ip = stdout.decode().strip()
        if not ip:
            # Fallback to any non-loopback interface if no wireless found
            cmd = "ip -4 -o addr show | grep -v 'lo' | head -n 1 | awk '{print $4}' | cut -d/ -f1"
            proc = await asyncio.create_subprocess_shell(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, _ = await proc.communicate()
            ip = stdout.decode().strip()
        return {"ip": ip or "Not found"}
    except Exception:
        return {"ip": "Error fetching IP"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/server/start")
async def start_server(config: ServerConfig):
    await cleanup_processes()
    cmd = f"iperf3 -s -p {config.port} -i {config.interval} --forceflush"
    asyncio.create_task(run_process(cmd, "server"))
    return {"status": "started", "command": cmd}


@app.post("/api/server/stop")
async def stop_server():
    p = processes.get("server")
    if p and p.returncode is None:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            # Extra safety: wait a bit and kill if still running
            await asyncio.sleep(0.5)
            if p.returncode is None:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)
        except:
            pass
        return {"status": "stopped"}
    return {"status": "not running"}

@app.post("/api/client/start")
async def start_client(config: ClientConfig):
    if processes.get("client") and processes["client"].returncode is None:
        return {"status": "error", "message": "Client already running"}
        
    cmd = (f"iperf3 -c {shlex.quote(config.host)} -p {config.port} "
           f"-t {config.duration} -i {config.interval} -P {config.parallel} "
           f"-l {config.length} --forceflush")
    
    if config.zerocopy:
        cmd += " -Z"
        
    if config.protocol == 'udp':
        cmd += f" -u -b {shlex.quote(config.bandwidth)}"
        
    asyncio.create_task(run_process(cmd, "client", "iperf"))
    
    # Start pinging for latency, matching the interval (min 0.2s for non-root)
    ping_interval = float(max(0.2, config.interval))
    ping_count = int(config.duration / ping_interval) + 2 if ping_interval > 0 else 10
    ping_cmd = f"ping -i {ping_interval} -c {ping_count} {shlex.quote(config.host)}"
    asyncio.create_task(run_process(ping_cmd, "client", "ping"))
    
    return {"status": "started", "command": cmd}

@app.post("/api/client/stop")
async def stop_client():
    for key in ["client", "ping"]:
        p = processes.get(key)
        if p and p.returncode is None:
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except:
                pass
    return {"status": "stopped"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
