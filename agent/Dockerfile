# Lightweight Alpine agent: mtr + the InfluxDB 3 writer.
# Run with:  docker run -d --net=host --cap-add=NET_RAW ... mtr-agent
FROM python:3.12-alpine

# mtr needs raw sockets at runtime (--cap-add=NET_RAW); the package itself is small.
RUN apk add --no-cache mtr

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py .

ENTRYPOINT ["python", "agent.py"]
