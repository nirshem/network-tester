Chart.defaults.color = '#8b949e';
Chart.defaults.font.family = "'Inter', sans-serif";

const grid = GridStack.init({
    cellHeight: 60,
    margin: 15,
    animate: true,
    draggable: { handle: 'h3' }
});

function saveLayout() {
    const layout = {};
    grid.getGridItems().forEach(el => {
        const node = el.gridstackNode;
        if (node.id) {
            layout[node.id] = { x: node.x, y: node.y, w: node.w, h: node.h };
        }
    });
    localStorage.setItem('network-tester-layout', JSON.stringify(layout));
}

function loadLayout() {
    const data = localStorage.getItem('network-tester-layout');
    if (!data) return;
    try {
        const layout = JSON.parse(data);
        grid.batchUpdate();
        grid.getGridItems().forEach(el => {
            const node = el.gridstackNode;
            const saved = layout[node.id];
            if (saved) {
                grid.update(el, { x: saved.x, y: saved.y, w: saved.w, h: saved.h });
            }
        });
        grid.commit();
    } catch (e) {
        console.error('Failed to load layout', e);
    }
}

// Apply saved layout
loadLayout();

grid.on('resizestop', () => {
    saveLayout();
    serverChart.resize();
    clientChart.resize();
});

grid.on('dragstop', saveLayout);
grid.on('change', saveLayout);

function createChart(canvasId, title) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Throughput (Mbps)',
                    data: [],
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    yAxisID: 'y',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: 2
                },
                {
                    label: 'Latency (ms)',
                    data: [],
                    borderColor: '#2ea043',
                    backgroundColor: 'transparent',
                    yAxisID: 'y1',
                    tension: 0.4,
                    borderDash: [5, 5],
                    borderWidth: 3,
                    pointRadius: 3
                },
                {
                    label: 'Jitter (ms)',
                    data: [],
                    borderColor: '#f0883e',
                    backgroundColor: 'transparent',
                    yAxisID: 'y1',
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Throughput (Mbps)' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    suggestedMin: 0,
                    suggestedMax: 10
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'Time (ms)' },
                    grid: { drawOnChartArea: false },
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

const serverChart = createChart('serverChart', 'Server Metrics');
const clientChart = createChart('clientChart', 'Client Metrics');

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
let ws;

function connectWebsocket() {
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'log') {
            const terminal = document.getElementById(`${msg.source}-terminal`);
            if (terminal) {
                const row = document.createElement('div');
                row.textContent = msg.data;
                terminal.appendChild(row);
                terminal.scrollTop = terminal.scrollHeight;
            }
        } else if (msg.type === 'metric') {
            const chart = msg.source === 'server' ? serverChart : clientChart;
            updateChart(chart, msg.data);
            updateStats(msg.source, msg.data);
        } else if (msg.type === 'status') {
            const statusDot = document.getElementById(`${msg.source}-status-dot`);
            const btnStart = document.getElementById(`btn-${msg.source}-start`);
            const btnStop = document.getElementById(`btn-${msg.source}-stop`);
            
            if (msg.data === 'ended') {
                if(statusDot) statusDot.classList.remove('active');
                if(btnStart) btnStart.disabled = false;
                if(btnStop) btnStop.disabled = true;
            } else if (msg.data.startsWith('Started')) {
                if(statusDot) statusDot.classList.add('active');
                if(btnStart) btnStart.disabled = true;
                if(btnStop) btnStop.disabled = false;
            }
        }
    };
    
    ws.onclose = () => {
        setTimeout(connectWebsocket, 1000);
    };
}

connectWebsocket();

let firstIPLoaded = false;
async function fetchIP() {
    try {
        const response = await fetch('/api/ip');
        const data = await response.json();
        const display = document.getElementById('wlan-ip');
        if (display) display.textContent = data.ip;
        
        // Pre-fill target host if it's the first load or if the field is empty
        const hostInput = document.getElementById('client-host');
        if (hostInput && data.ip !== 'Not found') {
            if (!firstIPLoaded || !hostInput.value) {
                hostInput.value = data.ip;
                firstIPLoaded = true;
            }
        }
    } catch (e) {
        const display = document.getElementById('wlan-ip');
        if (display) display.textContent = 'Error';
    }
}

let metricsHistory = {
    client: [],
    server: []
};

function updateStats(source, metrics) {
    const history = metricsHistory[source];
    // Add current metric with arrival timestamp
    history.push({ ...metrics, arrival: Date.now() });

    // Auto-cleanup history older than 60s for performance
    if (history.length > 500) {
        const cleanupLimit = Date.now() - 60000;
        while (history.length > 100 && history[0].arrival < cleanupLimit) {
            history.shift();
        }
    }

    const windowVal = document.getElementById(`${source}-avg-window`).value;
    let filtered;
    if (windowVal === 'all') {
        filtered = history;
    } else {
        const seconds = parseInt(windowVal);
        const limit = Date.now() - (seconds * 1000);
        filtered = history.filter(m => m.arrival >= limit);
    }

    if (filtered.length === 0) return;

    let tpSum = 0, latSum = 0, jitSum = 0, dropSum = 0, totalPktSum = 0, latSqSum = 0;
    let tpCount = 0, latCount = 0, jitCount = 0, dropCount = 0;

    filtered.forEach(m => {
        if (m.throughput !== undefined) { tpSum += m.throughput; tpCount++; }
        if (m.latency !== undefined) { 
            latSum += m.latency; 
            latSqSum += (m.latency * m.latency); 
            latCount++; 
        }
        if (m.jitter !== undefined) { jitSum += m.jitter; jitCount++; }
        if (m.lost_packets !== undefined) { dropSum += m.lost_packets; dropCount++; }
        if (m.total_packets !== undefined) { totalPktSum += m.total_packets; }
    });
    
    const tpEl = document.getElementById(`${source}-tp-avg`);
    const latEl = document.getElementById(`${source}-lat-avg`);
    const jitEl = document.getElementById(`${source}-jit-avg`);
    const dropEl = document.getElementById(`${source}-drop-avg`);
    const varEl = document.getElementById(`${source}-lat-var`);

    if (tpEl && tpCount > 0) tpEl.textContent = (tpSum / tpCount).toFixed(2) + ' Mbps';
    if (latEl && latCount > 0) {
        const avg = latSum / latCount;
        latEl.textContent = avg.toFixed(2) + ' ms';
        if (varEl) {
            const variance = (latSqSum / latCount) - (avg * avg);
            varEl.textContent = Math.max(0, variance).toFixed(2) + ' ms²';
        }
    }
    if (jitEl && jitCount > 0) jitEl.textContent = (jitSum / jitCount).toFixed(2) + ' ms';
    if (dropEl && dropCount > 0) {
        if (totalPktSum > 0) {
            const pct = (dropSum / totalPktSum) * 100;
            dropEl.textContent = `${dropSum} Drops (${pct.toFixed(2)}%)`;
        } else {
            dropEl.textContent = dropSum + ' Drops';
        }
    }
}

function resetStats(source) {
    metricsHistory[source] = [];
    const tpEl = document.getElementById(`${source}-tp-avg`);
    const latEl = document.getElementById(`${source}-lat-avg`);
    const jitEl = document.getElementById(`${source}-jit-avg`);
    const dropEl = document.getElementById(`${source}-drop-avg`);
    const varEl = document.getElementById(`${source}-lat-var`);
    if (tpEl) tpEl.textContent = '- Mbps';
    if (latEl) latEl.textContent = '- ms';
    if (jitEl) jitEl.textContent = '- ms';
    if (dropEl) dropEl.textContent = '- Drops';
    if (varEl) varEl.textContent = '- ms²';
}

// Immediate update when window selection changes
['client', 'server'].forEach(source => {
    const el = document.getElementById(`${source}-avg-window`);
    if (el) {
        el.addEventListener('change', () => {
            const history = metricsHistory[source];
            if (history.length > 0) {
                // Remove the last item we're about to "re-add" via updateStats
                const last = history.pop();
                updateStats(source, last);
            }
        });
    }
});

function updateClock() {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = String(now.getFullYear()).slice(-2);
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const el = document.getElementById('system-clock');
    if (el) el.textContent = `${d}/${m}/${y} ${h}:${min}:${s}`;
}
updateClock();
setInterval(updateClock, 1000);

fetchIP();
setInterval(fetchIP, 30000); // Update every 30 seconds

let lastTimeServer = -1;
let lastTimeClient = -1;

function updateChart(chart, metrics) {
    const isServer = chart === serverChart;
    let time = metrics.time;
    
    // If no time provided, we can't accurately place it on the X-axis
    if (time === undefined) return;
    
    const lastTime = isServer ? lastTimeServer : lastTimeClient;
    const labels = chart.data.labels;
    const len = labels.length;
    
    if (time === lastTime && len > 0) {
        // Update existing point
        const datasets = chart.data.datasets;
        if (metrics.throughput !== undefined) datasets[0].data[len-1] = metrics.throughput;
        if (metrics.latency !== undefined) datasets[1].data[len-1] = metrics.latency;
        if (metrics.jitter !== undefined) datasets[2].data[len-1] = metrics.jitter;
    } else {
        // New point
        if (isServer) lastTimeServer = time; else lastTimeClient = time;
        
        labels.push(time);
        
        const datasets = chart.data.datasets;
        datasets[0].data.push(metrics.throughput !== undefined ? metrics.throughput : (datasets[0].data[len-1] || null));
        datasets[1].data.push(metrics.latency !== undefined ? metrics.latency : (datasets[1].data[len-1] || null));
        datasets[2].data.push(metrics.jitter !== undefined ? metrics.jitter : (datasets[2].data[len-1] || null));
    }
    
    chart.update('none'); // Update without animation for performance
}

function clearTerminal(source) {
    const terminal = document.getElementById(`${source}-terminal`);
    if(terminal) terminal.innerHTML = '';
}

function clearChart(chart) {
    chart.data.labels = [];
    chart.data.datasets.forEach(dataset => dataset.data = []);
    chart.update();
}

document.getElementById('btn-server-start').addEventListener('click', async () => {
    const port = parseInt(document.getElementById('server-port').value);
    const interval = parseFloat(document.getElementById('server-interval').value);
    clearTerminal('server');
    clearChart(serverChart);
    resetStats('server');
    lastTimeServer = -1;
    
    const response = await fetch('/api/server/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({port, interval})
    });
    const data = await response.json();
    if (data.command) {
        document.getElementById('server-command').textContent = data.command;
    }
});

document.getElementById('btn-server-stop').addEventListener('click', async () => {
    await fetch('/api/server/stop', { method: 'POST' });
});

document.getElementById('btn-client-start').addEventListener('click', async () => {
    const config = {
        host: document.getElementById('client-host').value,
        port: parseInt(document.getElementById('client-port').value),
        protocol: document.getElementById('client-protocol').value,
        bandwidth: document.getElementById('client-bandwidth').value,
        duration: parseFloat(document.getElementById('client-duration').value),
        interval: parseFloat(document.getElementById('client-interval').value),
        parallel: parseInt(document.getElementById('client-parallel').value),
        length: parseInt(document.getElementById('client-length').value),
        zerocopy: document.getElementById('client-zerocopy').checked
    };
    clearTerminal('client');
    clearChart(clientChart);
    resetStats('client');
    lastTimeClient = -1;
    
    const response = await fetch('/api/client/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(config)
    });
    const data = await response.json();
    if (data.command) {
        document.getElementById('client-command').textContent = data.command;
    }
});

document.getElementById('btn-client-stop').addEventListener('click', async () => {
    await fetch('/api/client/stop', { method: 'POST' });
});
