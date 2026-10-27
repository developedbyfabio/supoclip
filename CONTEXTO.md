# Contexto do fork developedbyfabio/supoclip

Documento de referência para instalar, operar e continuar o desenvolvimento deste fork.
Vale para pessoas e para assistentes de IA (Claude Code etc.). Para detalhes do projeto
original, ver também `CLAUDE.md`, `README.md` e `docs/`.

## 1. O que é

SupoClip é uma alternativa open source ao OpusClip: recebe um vídeo longo (link do YouTube
ou upload) e gera automaticamente cortes verticais 9:16 com legendas, prontos para Shorts,
Reels e TikTok. Licença AGPL-3.0.

- Original: https://github.com/FujiwaraChoki/supoclip (remote `upstream`)
- Este fork: https://github.com/developedbyfabio/supoclip (remote `origin`, branch `main`)
- Base do fork: commit `8b8c683` do original

## 2. Como funciona

```
Navegador -> Frontend (Next.js, :3107) -> Backend API (FastAPI, :8000) -> Redis (fila) -> Worker (ARQ)
                                                  |                                          |
                                             PostgreSQL <-----------------------------------+
```

Pipeline de uma tarefa (roda no worker):

1. **Download**: yt-dlp baixa o vídeo do YouTube (ou usa o arquivo enviado).
2. **Transcrição**: Whisper local (faster-whisper) gera o texto com tempo de cada palavra.
3. **Análise**: o LLM (Gemini) lê a transcrição e escolhe os trechos com mais potencial
   viral, dando nota de 0 a 100 (`virality_score`) e um título de gancho.
4. **Corte**: MoviePy/FFmpeg recorta em 9:16, centraliza no rosto, queima legendas e título.
5. **Publicação (opcional)**: clipes vão para o YouTube na hora, agendados, ou pela
   postagem automática (seção 4.3).

Containers (`docker-compose.yml`):

| Serviço | Container | Porta no host | Função |
|---|---|---|---|
| frontend | supoclip-frontend | 127.0.0.1:3107 | Interface web, login (Better Auth) |
| backend | supoclip-backend | 127.0.0.1:8000 | API REST, docs em `/docs` |
| worker | supoclip-worker | - | Processa vídeos, publica posts (crons a cada minuto) |
| postgres | supoclip-postgres | - | Banco |
| redis | supoclip-redis | 127.0.0.1:6379 | Fila e progresso em tempo real |
| mcp | supoclip-mcp | 127.0.0.1:9100 | Opcional, **não usamos** |

Todas as portas ficam presas em 127.0.0.1: nada fica exposto na rede sem um proxy reverso.

## 3. Configuração que usamos

| Item | Valor | Motivo |
|---|---|---|
| LLM | `google-gla:gemini-3-flash-preview` | Chave gratuita do Google AI Studio |
| Transcrição | `TRANSCRIPTION_PROVIDER=whisper`, `WHISPER_MODEL_SIZE=small` | Local e grátis (AssemblyAI é pago) |
| Torch/CPU | `BACKEND_CPU_ONLY=true` | Máquina sem GPU NVIDIA |
| Publicação | `SOCIAL_PUBLISHING_ACCESS=all`, `SOCIAL_PUBLISHING_PROVIDERS=youtube` | Só YouTube por enquanto |

Desempenho medido (notebook i5-1334U, só CPU, modelo `small`): vídeo de 22 min levou
cerca de 17 min de transcrição e 24 min no total para gerar 5 clipes. Em servidor com
mais núcleos, deve ser mais rápido.

`youtube_captions` como provedor de transcrição **não serve**: só busca legenda em inglês
e sem tempo por palavra.

## 4. O que mudamos em relação ao original

Três commits sobre o `8b8c683`:

### 4.1 Segurança: SSRF e TLS (`82fafde`)

Arquivo: `backend/src/youtube_utils.py`

- `get_youtube_video_id` só aceita `http(s)` em `youtube.com`, `youtu.be`,
  `youtube-nocookie.com` (e subdomínios). Recusa usuário/senha na URL, barra invertida e
  espaços. Antes, uma URL forjada podia fazer o servidor acessar endereços internos.
- `nocheckcertificate` passou de `True` para `False`: o yt-dlp volta a validar HTTPS.

### 4.2 Transcrição com faster-whisper (`67f50f7`)

Arquivos: `backend/src/media/transcription.py`, `backend/pyproject.toml`, `backend/uv.lock`,
`docker-compose.yml`

- `transcribe_with_whisper` tenta primeiro o faster-whisper (CTranslate2): `int8` na CPU,
  `float16` se houver GPU NVIDIA, `vad_filter=True`, `beam_size=1`, log
  `Transcription progress: N%` a cada 10%.
- Mesmo formato de saída do openai-whisper. Se o pacote não existir, cai no openai-whisper.
- Volume novo `model_cache` em `/root/.cache/huggingface` do worker: o modelo não é
  baixado de novo a cada recriação do container.
- Resultado: o openai-whisper em CPU passou de 65 min sem terminar o mesmo vídeo; com
  faster-whisper foram cerca de 17 min.

### 4.3 Postagem automática (`c996cc1`)

Ao concluir uma tarefa, os melhores clipes são agendados sozinhos no YouTube.

- Tela: **Configurações > Social > Postagem automática** (aparece com ao menos uma conta conectada).
- Regra por usuário: contas, clipes por vídeo (1 a 10), score mínimo (0 a 100), horários
  `HH:MM` (até 6), fuso, privacidade e hashtags.
- Cada clipe vai para o próximo horário livre de cada conta, com 10 min de antecedência
  mínima e sem duplicar clipe na mesma conta. Quem publica é o cron
  `dispatch_scheduled_social_posts` do worker.
- Se a postagem automática falhar, a tarefa não falha: só registra no log.

Arquivos:

| Arquivo | Papel |
|---|---|
| `backend/src/migrations/sql/20261027_0001_social_auto_publish.sql` | Tabela `social_auto_publish` (aplicada sozinha ao subir o backend) |
| `backend/src/repositories/social_repository.py` | `get_auto_publish`, `upsert_auto_publish`, `list_taken_slots`, `clip_has_post` |
| `backend/src/services/social_service.py` | Validação, `auto_publish_task`, cálculo de horários (`_next_free_slot`) |
| `backend/src/api/routes/social.py` | `GET`/`POST /social/auto-publish` |
| `backend/src/services/task_service.py` | `_auto_publish_if_enabled` após concluir a tarefa |
| `frontend/src/components/auto-publish-settings.tsx` | Formulário |
| `frontend/src/app/settings/social/page.tsx` | Mostra o formulário |
| `frontend/messages/*/social.json` | Textos nos 6 idiomas |

Testado: unidade do agendamento, validações da API e fluxo completo com rollback no banco.
**Não testado ainda**: upload real no YouTube (faltavam as credenciais OAuth).

Atenção ao criar migrações: o executor divide o SQL por `;`, então comentários SQL não
podem conter ponto e vírgula.

## 5. Auditoria de segurança (resumo)

| Risco | Situação |
|---|---|
| SSRF via URL do YouTube | Corrigido (4.1) |
| yt-dlp sem validar certificado | Corrigido (4.1) |
| Segredos padrão fracos no `.env.example` | Gerar valores aleatórios (seção 6) |
| Cadastro aberto (`DISABLE_SIGN_UP=false`) | Fechar após criar sua conta |
| Dockerfiles usam `curl \| sh` sem versão fixa; MCP sem lockfile | Aceito; não usamos o MCP |
| `install_cron.sh` faz `git pull` + rebuild automático do original | **Nunca executar** |
| Containers rodam como root (exceto frontend em produção) | Aceito; portas só em 127.0.0.1 |
| Frontend em modo desenvolvimento por padrão | Usar modo produção no servidor |
| Transcrições e títulos vão para a API do Gemini | Plano gratuito do Google pode usar os dados; não processar conteúdo sigiloso |
| Senha do Postgres fixa no compose (`supoclip_password`) | Banco não é exposto fora da rede do Docker |

Pontos limpos: sem segredos no código, sem código ofuscado, telemetria desligada sem
tokens, dependências só de PyPI/PyTorch/npm, arquivos servidos checam o dono.

## 6. Instalação em servidor Linux

### 6.1 Requisitos

- Docker Engine + plugin `docker compose` (https://docs.docker.com/engine/install/)
- x86_64 (amd64). Mínimo 4 vCPU e 8 GB de RAM; recomendado 8+ vCPU e 16 GB
- 30 GB livres ou mais (imagens com PyTorch são grandes; vídeos e clipes ocupam espaço)
- Acesso de saída à internet (YouTube, Google AI, Hugging Face para o modelo Whisper)

### 6.2 Clonar e configurar

```bash
git clone https://github.com/developedbyfabio/supoclip.git
cd supoclip
git remote add upstream https://github.com/FujiwaraChoki/supoclip.git
cp .env.example .env
chmod 600 .env
```

Gerar segredos (um valor diferente para cada):

```bash
for k in BETTER_AUTH_SECRET BACKEND_AUTH_SECRET APP_SETTINGS_ENCRYPTION_KEY REDIS_PASSWORD; do
  sed -i "s|^#\?\s*$k=.*|$k=$(openssl rand -hex 32)|" .env
done
grep -cE '^(BETTER_AUTH_SECRET|BACKEND_AUTH_SECRET|APP_SETTINGS_ENCRYPTION_KEY|REDIS_PASSWORD)=' .env   # deve dar 4
```

Ajustar no `.env` (trocar `clip.seudominio.com.br` pelo endereço real):

```env
# IA e transcrição
LLM=google-gla:gemini-3-flash-preview
GOOGLE_API_KEY=<sua chave do Google AI Studio>
TRANSCRIPTION_PROVIDER=whisper
WHISPER_MODEL_SIZE=small
BACKEND_CPU_ONLY=true

# Frontend em produção (menos RAM, sem hot reload)
FRONTEND_BUILD_TARGET=production
NODE_ENV=production

# Endereços públicos (com proxy reverso + HTTPS)
NEXT_PUBLIC_APP_URL=https://clip.seudominio.com.br
BETTER_AUTH_URL=https://clip.seudominio.com.br
CORS_ORIGINS=https://clip.seudominio.com.br
NEXT_PUBLIC_API_URL=https://api-clip.seudominio.com.br
SOCIAL_OAUTH_REDIRECT_BASE_URL=https://clip.seudominio.com.br

# Publicação no YouTube
SOCIAL_PUBLISHING_ACCESS=all
SOCIAL_PUBLISHING_PROVIDERS=youtube
YOUTUBE_OAUTH_CLIENT_ID=
YOUTUBE_OAUTH_CLIENT_SECRET=

# Fechar depois de criar a sua conta (seção 6.5)
DISABLE_SIGN_UP=false
```

Notas:

- `NEXT_PUBLIC_*` entram no build do frontend em produção. Mudou? Rebuild:
  `docker compose up -d --build frontend`.
- `NEXT_PUBLIC_API_URL` precisa ser alcançável pelo navegador só para **upload de arquivo**.
  Se for usar apenas links do YouTube, pode ignorar o subdomínio da API.
- Sem domínio (acesso só por túnel SSH, seção 6.4): deixar os valores com
  `http://localhost:3107` e `http://localhost:8000`, como no `.env.example`.

### 6.3 Subir

```bash
docker compose up -d --build postgres redis backend worker frontend
docker compose ps          # todos "healthy" após alguns minutos
docker compose logs -f worker
```

Não usar `docker compose up -d` puro: ele também sobe o `mcp`, que não usamos.
O primeiro build demora (dependências Python/PyTorch e build do Next.js). A primeira
transcrição baixa o modelo Whisper para o volume `model_cache`.

O modo produção do frontend (`FRONTEND_BUILD_TARGET=production`) é suportado pelo
projeto original, mas neste fork só foi testado o modo desenvolvimento. Se der problema,
voltar para `development` remove a dúvida (consome cerca de 2,8 GB de RAM a mais).

### 6.4 Acesso

**Opção A: só você, sem expor nada (mais seguro).** Do seu computador:

```bash
ssh -L 3107:127.0.0.1:3107 -L 8000:127.0.0.1:8000 usuario@servidor
```

E abrir http://localhost:3107. O OAuth do Google aceita `http://localhost` como redirect.

**Opção B: domínio com HTTPS.** Caddy (certificado automático), `/etc/caddy/Caddyfile`:

```caddy
clip.seudominio.com.br {
    reverse_proxy 127.0.0.1:3107
}

api-clip.seudominio.com.br {
    reverse_proxy 127.0.0.1:8000
}
```

Com nginx, em ambos os `location`: `client_max_body_size 4G;`,
`proxy_read_timeout 3600s;` e `proxy_buffering off;` (o progresso usa SSE e trava com buffer).

Firewall: liberar só 22, 80 e 443. As portas do Docker já estão em 127.0.0.1.

### 6.5 Primeiro acesso

1. Criar a sua conta na tela de cadastro.
2. Fechar o cadastro: `DISABLE_SIGN_UP=true` no `.env` e `docker compose up -d frontend`.
3. Testar com um vídeo curto do YouTube antes de vídeos longos.

### 6.6 GPU NVIDIA (opcional, não testado)

Com GPU NVIDIA no servidor: instalar o NVIDIA Container Toolkit, pôr `BACKEND_CPU_ONLY=false`
e criar `docker-compose.override.yml`:

```yaml
services:
  worker:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

Depois `docker compose up -d --build backend worker`. O faster-whisper detecta a GPU sozinho
(`float16`). Conferir no log do worker se não aparece erro de cuDNN/cuBLAS; dá para subir
`WHISPER_MODEL_SIZE` para `medium` com GPU. GPUs AMD/Intel não são aceleradas hoje.

## 7. Publicação no YouTube

### 7.1 Criar o cliente OAuth (Google Cloud Console)

1. Criar um projeto, ativar **YouTube Data API v3**.
2. Tela de consentimento OAuth: tipo **Externo**, adicionar seu e-mail como usuário de teste.
3. Credenciais > Criar ID do cliente OAuth > **Aplicativo da Web**.
4. URI de redirecionamento autorizado:
   - com domínio: `https://clip.seudominio.com.br/api/social/callback/youtube`
   - com túnel SSH: `http://localhost:3107/api/social/callback/youtube`
5. Copiar ID e chave secreta para `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET`.
6. `docker compose up -d backend worker`.
7. No app: Configurações > Social > conectar YouTube, depois ligar a postagem automática.

### 7.2 Limites do Google (não são do SupoClip)

- **Vídeos privados**: projeto não auditado só consegue subir vídeo privado, mesmo
  escolhendo "Público". Para liberar: formulário "YouTube API Services - Audit and Quota
  Extension" (gratuito, leva dias a semanas). Enquanto isso, mudar para público em lote no
  YouTube Studio.
- **Cota**: 10.000 unidades/dia por projeto; um upload custa muito mais que uma leitura
  (em torno de 6 uploads/dia no padrão). Aumento pelo mesmo formulário.
- **Token de 7 dias**: com a tela de consentimento em modo "Teste", a conexão expira a cada
  7 dias. Publicar o app (mesmo sem verificação) evita isso.

### 7.3 Instagram (futuro)

Exige o SupoClip acessível na internet com HTTPS (`SOCIAL_PUBLIC_MEDIA_BASE_URL`), porque o
Instagram busca o vídeo por URL, e um app Meta com Instagram Login.

## 8. Operação

```bash
docker compose ps
docker compose logs -f worker              # processamento e publicação
docker compose logs -f backend
docker compose restart worker
docker compose stop                         # para tudo, mantém dados
```

**Nunca** usar `docker compose down -v`: o `-v` apaga os volumes (banco, vídeos, clipes).

Backup:

```bash
docker compose exec -T postgres pg_dump -U supoclip supoclip > backup-$(date +%F).sql
docker run --rm -v supoclip_clips:/d -v "$PWD":/b alpine tar czf /b/clips-$(date +%F).tgz -C /d .
```

O nome do volume depende da pasta do projeto: conferir com `docker volume ls`.

Atualizar a partir deste fork:

```bash
git pull
docker compose up -d --build backend worker frontend
```

Trazer novidades do original (revisar antes; pode haver conflito com as mudanças da seção 4):

```bash
git fetch upstream
git merge upstream/main
```

## 9. Pendências e ideias

- Testar upload real no YouTube depois de configurar o OAuth.
- Pedir a auditoria da API do YouTube para publicar vídeos públicos.
- Fase 2 da transcrição: whisper.cpp com Vulkan para acelerar em qualquer GPU (AMD, Intel, NVIDIA).
- Instagram, com túnel ou domínio HTTPS e endurecimento de segurança.
- Rodar backend/worker sem root e fixar versões dos instaladores nos Dockerfiles.
