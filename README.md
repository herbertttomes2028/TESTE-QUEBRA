# 🧩 Quebra-Cabeça a Dois

Jogo de quebra-cabeça cooperativo online: duas pessoas, cada uma no seu celular (ou computador), montam **a mesma imagem ao mesmo tempo**, vendo os movimentos uma da outra em tempo real.

- Feito para **celular** (toque, tela em pé), mas funciona também no computador.
- Não precisa instalar nada no seu computador: tudo é feito pelos sites do **GitHub** e do **Render**.
- Entra direto no jogo: o código da sala é **gerado automaticamente** e o amigo entra por código ou por link.

---

## Como o jogo funciona

1. Uma pessoa toca em **Criar partida**, escolhe uma das imagens e o jogo cria a sala com um código de 4 caracteres (ex.: `K7MQ`).
2. Ela envia o **código ou o link** (botões *Convidar* e *WhatsApp*) para o amigo.
3. O amigo abre o link (ou digita o código em **Entrar com código**) e os dois jogam juntos.
4. As peças começam **embaralhadas e giradas** na bandeja, embaixo do tabuleiro.
5. **Arraste** uma peça até o tabuleiro. Ao soltar perto do lugar certo (e com a peça na posição certa), ela **encaixa e trava**.
6. **Toque** numa peça para escolhê-la e use o botão **↻ Girar**. Cada peça aceita **até 3 giros** por vez; depois disso é preciso encaixar ou soltá-la (ao soltar, os giros são renovados).
7. **Exclusividade:** enquanto uma pessoa segura uma peça (aparece com um contorno colorido), a outra **não consegue** pegá-la, movê-la ou girá-la.
8. Quando as 12 peças encaixam, aparece a tela de vitória com o **tempo** e quantas peças cada um encaixou.

Cores: você e seu amigo têm cores diferentes (azul e rosa); o contorno da peça mostra quem a está segurando.
Botão **Ver modelo** mostra a imagem completa por cima do tabuleiro, como ajuda.
O menu (☰) permite copiar o link, **trocar a imagem** e recomeçar.

---

## Estrutura do projeto

```
quebra-cabeca/
├── package.json          dependências e comando de início (npm start)
├── server.js             servidor (Express + Socket.IO): regras e sincronização
├── render.yaml           (opcional) configuração pronta para o Render
├── .gitignore
├── README.md
└── public/
    ├── index.html        telas do jogo
    ├── style.css         visual
    ├── game.js           lógica do jogo no navegador
    └── imagens/
        ├── imagem1.jpg   ← imagens de EXEMPLO (troque pelas suas)
        ├── imagem2.jpg
        ├── imagem3.jpg
        └── imagem4.jpg
```

---

## Passo 1 — Coloque as suas imagens

As quatro imagens que vêm no projeto são **exemplos** (ilustrações simples feitas só para o jogo funcionar). Para usar as suas:

1. Apague os arquivos `imagem1.jpg` a `imagem4.jpg` da pasta `public/imagens/` e coloque os seus (ou simplesmente **substitua** mantendo os mesmos nomes).
2. O jogo mostra **todas** as imagens `.jpg`, `.jpeg`, `.png` ou `.webp` que estiverem nessa pasta (até 12). Se quiser exatamente 4 opções, deixe só 4 arquivos.
3. O nome do arquivo vira o rótulo na tela (`praia.jpg` → "Praia").

**Dicas para ficar leve e sem travar no celular:**

- Formato ideal: **em pé (3:4)**, por exemplo **900 × 1200 pixels**. Outras proporções funcionam: o jogo recorta o centro automaticamente.
- Tamanho do arquivo: de preferência **abaixo de 500 KB** cada. Fotos enormes (vários MB) demoram para carregar. O jogo já reduz a imagem para 720 × 960 antes de montar as peças, mas arquivos menores abrem mais rápido.
- Prefira imagens com **detalhes variados** (se a imagem for quase toda de uma cor só, as peças ficam difíceis de diferenciar).

---

## Passo 2 — Envie o projeto para o GitHub (pelo site)

> **Importante:** o GitHub **guarda** o código, mas **não executa** o servidor do jogo (o GitHub Pages só serve páginas simples). Quem coloca o jogo no ar é o **Render**, no Passo 3, lendo o código direto do seu repositório.

1. Entre em <https://github.com> e faça login (ou crie uma conta gratuita).
2. Clique no **+** no canto superior direito → **New repository**.
3. Em *Repository name* escreva, por exemplo, `quebra-cabeca`. Deixe **Public** (ou Private, funciona nos dois) e clique em **Create repository**.
4. Na página do repositório vazio, clique em **uploading an existing file** (ou *Add file → Upload files*).
5. **Descompacte** o `.zip` do projeto no seu aparelho e **arraste o conteúdo da pasta `quebra-cabeca`** (os arquivos `server.js`, `package.json`, `README.md`, `render.yaml`, `.gitignore` e a pasta `public`) para a área de upload.
   - Os arquivos precisam ficar **na raiz** do repositório (`server.js` e `package.json` logo na primeira página, não dentro de outra pasta).
   - A pasta `public` (com `imagens` dentro) precisa subir **junto**. Se o seu navegador não aceitar arrastar pastas, use *Add file → Create new file*, digite o caminho no nome (por exemplo `public/index.html`) e cole o conteúdo; as imagens você envia pelo *Upload files* dentro da pasta `public/imagens`.
6. Role até o fim e clique em **Commit changes**.

Confira: no repositório você deve ver `server.js`, `package.json` e a pasta `public` na primeira tela.

---

## Passo 3 — Coloque o jogo no ar no Render (grátis)

1. Entre em <https://render.com> e crie uma conta (pode usar o login do GitHub).
2. Clique em **New +** → **Web Service**.
3. Escolha **Build and deploy from a Git repository** e conecte sua conta do GitHub (autorize o acesso ao repositório `quebra-cabeca`).
4. Selecione o repositório e clique em **Connect**.
5. Preencha:

   | Campo | Valor |
   |---|---|
   | **Name** | `quebra-cabeca` (vira parte do endereço) |
   | **Region** | a mais próxima (ex.: *Ohio* ou *Virginia*) |
   | **Branch** | `main` |
   | **Runtime / Language** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | `Free` |

6. (Opcional) Em *Advanced* → **Health Check Path**: `/health`.
7. Clique em **Create Web Service** e aguarde o *deploy* (1 a 3 minutos). Quando aparecer **Live**, o endereço estará no topo, algo como `https://quebra-cabeca.onrender.com`.

> **Alternativa mais rápida:** o projeto traz um `render.yaml`. No Render, use **New + → Blueprint**, escolha o repositório e confirme. Ele preenche tudo acima sozinho.

**Atualizar depois:** sempre que você trocar arquivos no GitHub (por exemplo, as imagens), o Render publica a nova versão automaticamente.

---

## Passo 4 — Jogar

1. Abra o endereço do Render no celular.
2. Toque em **Criar partida**, escolha a imagem e toque em **Criar partida** de novo.
3. Toque em **Convidar** (ou **WhatsApp**) e mande para o amigo.
4. O amigo abre o link. Pronto: o relógio começa quando os dois estão na sala.

---

## Como testar

### Antes de chamar o amigo (sem instalar nada)

Depois de publicado no Render:

1. No computador, abra o endereço do jogo em **duas abas** (ou uma aba normal e uma anônima).
2. Na primeira aba, crie a partida. Copie o código.
3. Na segunda aba, digite o código em **Entrar com código** (ou abra o link `…/?sala=CÓDIGO`).
4. Mova uma peça numa aba e veja se ela se mexe na outra. Tente pegar, na segunda aba, uma peça que a primeira está segurando: o jogo deve avisar que o amigo está com ela.

### No celular

1. Abra o endereço no celular e crie a partida.
2. No computador (ou em outro celular), entre pelo link.
3. Teste: arrastar com o dedo, tocar numa peça e girar, encaixar, ver o modelo, bloquear e desbloquear a tela (o jogo reconecta sozinho), e terminar o quebra-cabeça.

### No seu computador, se um dia tiver o Node.js instalado (opcional)

```
npm install
npm start
```

Abra `http://localhost:3000` em duas abas e siga o mesmo teste acima.

---

## Se algo não funcionar

- **A primeira abertura demora (30–60 s):** é normal no plano gratuito do Render, que "dorme" depois de uns 15 minutos sem uso. Abra o link antes de chamar o amigo.
- **"Não encontramos essa sala":** confira o código (são 4 caracteres, letras e números). A sala também some se o Render reiniciar o serviço; é só criar outra.
- **"Essa sala já tem duas pessoas":** a sala comporta exatamente duas pessoas. Se alguém caiu, ao voltar pelo mesmo link ela retoma o lugar.
- **Aparece "Reconectando…":** a internet oscilou. O jogo volta sozinho e mantém o progresso.
- **"Nenhuma imagem encontrada":** a pasta `public/imagens` está vazia ou foi enviada fora do lugar no GitHub.
- **A imagem não aparece:** verifique se a extensão é `.jpg`, `.jpeg`, `.png` ou `.webp` e se o arquivo abre normalmente.
- **Jogo na horizontal:** funciona, mas as peças ficam menores. O ideal é jogar com o celular **em pé**.

---

## Checklist antes de publicar

- [ ] Substituí as imagens de exemplo pelas minhas em `public/imagens/` (ou decidi manter os exemplos).
- [ ] As imagens são leves (de preferência abaixo de 500 KB) e abrem normalmente.
- [ ] No GitHub, `server.js` e `package.json` aparecem na **primeira tela** do repositório (não dentro de outra pasta).
- [ ] A pasta `public` subiu com `index.html`, `style.css`, `game.js` e a pasta `imagens`.
- [ ] No Render: Build Command `npm install` e Start Command `npm start`.
- [ ] O deploy terminou como **Live** e `https://SEU-ENDERECO.onrender.com/health` mostra `ok`.
- [ ] Abri o jogo em duas abas: criar partida, entrar com o código, mover uma peça e ver nas duas telas.
- [ ] Testei no celular: arrastar, girar (máx. 3 giros), encaixar e a tela de vitória.
- [ ] Testei a regra de exclusividade (a segunda pessoa não consegue pegar a peça que a primeira segura).
- [ ] Combinei com o amigo de abrir o link um pouco antes (por causa do "sono" do plano gratuito).

Bom jogo! 🧩
