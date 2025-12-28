FROM python:3.11-slim

# Install SSH client and git
RUN apt-get update && apt-get install -y \
    openssh-client \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server code
COPY server.py .

# SSH key will be written from env var at runtime
# Configure SSH to not do strict host checking
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh
RUN echo "Host *\n  StrictHostKeyChecking no\n  UserKnownHostsFile=/dev/null" > /root/.ssh/config
RUN chmod 600 /root/.ssh/config

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "600", "server:app"]
