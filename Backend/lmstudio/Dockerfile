FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Installation des dépendances
RUN apt-get update && apt-get install -y \
    wget \
    libgl1-mesa-glx \
    libglib2.0-0 \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Télécharger et installer LM Studio Server
WORKDIR /app
RUN wget https://huggingface.co/api-inference/starcoder2-7b/resolve/main/lm-studio-server-linux-x64.zip && \
    unzip lm-studio-server-linux-x64.zip && \
    rm lm-studio-server-linux-x64.zip

# Créer un répertoire pour les modèles
RUN mkdir -p /app/models

# Copier le modèle dans le conteneur (à adapter selon votre modèle)
COPY ./DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf /app/models/

# Exposition du port
EXPOSE 1234

# Démarrer LM Studio Server avec votre modèle
CMD ["/app/lm-studio-server", "--model", "/app/models/DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf", "--host", "0.0.0.0", "--port", "1234"]