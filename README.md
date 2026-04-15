# P2P IP Network Performance Tester

A modern, real-time web interface for `iperf3` that allows you to monitor network throughput, latency, and jitter from a convenient dashboard.

## Features

- **Real-time Graphs**: Interactive charts showing throughput (Mbps), latency (ms), and jitter (ms).
- **Full Configuration**: Configure all `iperf3` parameters (port, duration, interval, parallel streams, zero-copy, packet length) through the UI.
- **Server & Client Management**: Start/stop both an `iperf3` server and client directly from the web browser.
- **Wireless IP Display**: View your current WLAN interface IP address directly on the dashboard.
- **Command Preview**: See the exact shell command being executed in the background.
- **Terminal View**: Real-time terminal output logs for both server and client.

## Requirements

- **Linux OS** (Tested on Linux)
- **iperf3** installed (`sudo apt install iperf3`)
- **Python 3.10+**

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/network-tester.git
   cd network-tester
   ```

2. **Create a virtual environment** (optional but recommended):
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

1. **Start the application**:
   ```bash
   python3 main.py
   ```

2. **Access the Web UI**:
   Open your browser and navigate to `http://localhost:8000`.

3. **Running a test**:
   - **Step 1**: Start the Server on the destination machine.
   - **Step 2**: Enter the Server's IP address in the Client panel of the source machine.
   - **Step 3**: Click "Start Test" to begin monitoring.

Remark:
GUI widgets positions and size can be modify in your browser, the customize layout will be saved in your browser configuration for the next startup.

## License

Free

<img width="1886" height="1048" alt="Screenshot from 2026-04-15 09-38-24" src="https://github.com/user-attachments/assets/a6e5ba0d-97c9-4136-91ea-7509911bf1d4" />

