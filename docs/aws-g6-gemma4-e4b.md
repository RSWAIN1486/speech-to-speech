# AWS G6 Gemma 4 E4B

This guide keeps the browser UI on your local Mac and runs the realtime backend on a single AWS `g6.xlarge` GPU instance.

Current target:

- model server: `google/gemma-4-E4B-it` through `vLLM`
- realtime backend: `speech-to-speech`
- local browser: `demo/` served on your Mac

Notes:

- `g6.xlarge` is the minimum AWS size we recommend trying first for this stack.
- This is a tight one-box setup, so the guide leaves Gemma on GPU and pins STT + TTS to CPU.
- The browser still uses your local camera and microphone. Only the websocket traffic goes to AWS.

## 1. Launch the EC2 instance

Assumptions:

- AWS CLI is already configured locally.
- Region is `us-east-1`.
- You want to SSH tunnel the websocket instead of opening it publicly.

```bash
export REGION=us-east-1
export KEY_NAME=s2s-g6-key
export INSTANCE_NAME=gemma4e4b-s2s
export MY_IP=$(curl -s https://checkip.amazonaws.com | tr -d '\n')
```

Create a key pair if needed:

```bash
aws ec2 create-key-pair \
  --region "$REGION" \
  --key-name "$KEY_NAME" \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/$KEY_NAME.pem

chmod 600 ~/.ssh/$KEY_NAME.pem
```

Resolve the latest Deep Learning Base AMI, default VPC, and subnet:

```bash
export AMI_ID=$(aws ssm get-parameter \
  --region "$REGION" \
  --name /aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id \
  --query 'Parameter.Value' \
  --output text)

export VPC_ID=$(aws ec2 describe-vpcs \
  --region "$REGION" \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' \
  --output text)

export SUBNET_ID=$(aws ec2 describe-subnets \
  --region "$REGION" \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' \
  --output text)
```

Create a security group with SSH access from your current public IP:

```bash
export SG_ID=$(aws ec2 create-security-group \
  --region "$REGION" \
  --group-name "${INSTANCE_NAME}-sg" \
  --description "SSH for ${INSTANCE_NAME}" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' \
  --output text)

aws ec2 authorize-security-group-ingress \
  --region "$REGION" \
  --group-id "$SG_ID" \
  --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":22,\"ToPort\":22,\"IpRanges\":[{\"CidrIp\":\"${MY_IP}/32\",\"Description\":\"My laptop\"}]}]"
```

Launch the instance:

```bash
export INSTANCE_ID=$(aws ec2 run-instances \
  --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type g6.xlarge \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --subnet-id "$SUBNET_ID" \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":200,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

export PUBLIC_IP=$(aws ec2 describe-instances \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "$PUBLIC_IP"
```

## 2. Prepare the instance

SSH in:

```bash
ssh -i ~/.ssh/$KEY_NAME.pem ubuntu@$PUBLIC_IP
```

Install base tools:

```bash
nvidia-smi
sudo apt-get update
sudo apt-get install -y git tmux build-essential libsndfile1
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.local/bin/env
```

Clone the repo and install the backend environment:

```bash
git clone https://github.com/RSWAIN1486/speech-to-speech.git
cd speech-to-speech
uv sync --python 3.12 --extra kokoro --dev
```

Create a separate `vLLM` environment:

```bash
uv venv ~/vllm-env --python 3.12
source ~/vllm-env/bin/activate
uv pip install -U vllm
```

Export your Hugging Face token:

```bash
export HF_TOKEN=YOUR_HF_TOKEN
```

## 3. Start Gemma 4 E4B with vLLM

Use a conservative config first because `g6.xlarge` is the minimum target:

```bash
source ~/vllm-env/bin/activate

vllm serve google/gemma-4-E4B-it \
  --host 127.0.0.1 \
  --port 8000 \
  --dtype bfloat16 \
  --gpu-memory-utilization 0.80 \
  --max-model-len 2048 \
  --limit-mm-per-prompt image=1
```

If this runs out of memory, reduce `--max-model-len` to `1024`.

## 4. Start the realtime backend

Open a second SSH session to the same instance:

```bash
ssh -i ~/.ssh/$KEY_NAME.pem ubuntu@$PUBLIC_IP
```

Then start `speech-to-speech`:

```bash
cd ~/speech-to-speech

.venv/bin/speech-to-speech \
  --mode realtime \
  --ws_port 8876 \
  --stt parakeet-tdt \
  --parakeet_tdt_device cpu \
  --llm_backend chat-completions \
  --model_name google/gemma-4-E4B-it \
  --responses_api_base_url http://127.0.0.1:8000/v1 \
  --responses_api_stream \
  --tts kokoro \
  --kokoro_device cpu \
  --enable_live_transcription \
  --log_level info
```

## 5. Connect from your Mac

Create an SSH tunnel from your laptop:

```bash
ssh -i ~/.ssh/$KEY_NAME.pem -N -L 8876:127.0.0.1:8876 ubuntu@$PUBLIC_IP
```

Then serve the local browser UI from your Mac:

```bash
python3 -m http.server 8000 -d demo
```

Open:

```text
http://127.0.0.1:8000
```

Leave the websocket field set to:

```text
ws://127.0.0.1:8876/v1/realtime
```

## 6. Tuning notes

- `g6.xlarge` is the cheapest first try, not the most comfortable production size.
- Keep STT and TTS on CPU on this size unless profiling shows spare GPU headroom.
- The current browser demo sends one low-detail still frame per turn. Accuracy will improve more if you also increase snapshot quality or resolution.
