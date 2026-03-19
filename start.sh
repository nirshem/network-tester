#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    echo "Installing requirements..."
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo "Stopping any lingering iperf3 or ping processes..."
pkill -f iperf3 || true
pkill -f ping || true

echo "Starting Network Tester UI on http://localhost:8000"
uvicorn main:app --host 0.0.0.0 --port 8000
