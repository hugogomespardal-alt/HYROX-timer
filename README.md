# HYROX Simulation Timer — CrossFit Viseu

Aplicação web completa para **cronometrar, controlar e analisar** uma simulação HYROX:
criação de atletas, vagas de partida, cronometragem por estação, penalizações, validação,
classificações por prova, relatórios individuais com gráficos e exportação para
**Excel, CSV, PDF, imagem e resumo WhatsApp**.

Funciona em **computador, tablet e telemóvel**, com **modo claro/escuro**, botões grandes e
**funcionamento offline** (os dados ficam guardados localmente no dispositivo).

---

## 1. Conteúdo do pacote

```
hyrox-timer/
├── index.html                 → a aplicação
├── styles.css                 → estilos (marca CrossFit Viseu)
├── app.js                     → motor: cronometragem, cálculos, classificações, exportações
├── manifest.webmanifest       → PWA (instalável)
├── sw.js                      → service worker (cache offline)
├── assets/                    → logótipo e ícones (V CrossFit Viseu)
├── atletas_exemplo.csv        → ficheiro de importação de atletas (8 atletas)
├── supabase_sync.sql          → tabela de sincronização (Cenário B: ecrã/TV separado) — usada pela app
├── supabase_schema.sql        → modelo relacional (referência avançada, opcional)
├── README.md                  → este ficheiro
└── MANUAL.md                  → manual de utilização
```

---

## 2. Utilização imediata (sem instalar nada)

1. Descompacta a pasta.
2. Abre o ficheiro **`index.html`** num navegador (Chrome, Edge, Safari, Firefox).
3. Vai a **Admin** e clica em **Carregar dados de teste** — ficas com 8 atletas e 2 vagas
   prontos para simular uma prova completa.

> **No telemóvel, roda para horizontal durante a cronometragem.** A vista Central
> passa a mostrar vários atletas ao mesmo tempo, com cartões e botões maiores. É o modo
> recomendado durante a prova (funciona em Android e iPhone).

> Ao abrir por ficheiro (`file://`) a app funciona e guarda tudo localmente.
> O botão de *instalar como aplicação* (PWA) só aparece quando a serves por `http/https` (ponto 4).

---

## 3. Simular uma prova em 6 passos

1. **Admin → Carregar dados de teste** (ou importa o `atletas_exemplo.csv`).
2. **Vagas e Atletas →** *Iniciar todos* para dar a partida simultânea.
3. **Modo Central** ou **Modo Estação →** regista cada ENTRADA/SAÍDA (o botão muda sozinho).
   Enganaste-te? **↶ Voltar atrás** anula o último registo sem reiniciar o cronómetro.
4. **Penalizações →** adiciona penalizações quando necessário.
5. No cartão do atleta que terminou → **✔ Validar resultado** (botão verde).
6. **Classificações** e **Relatórios →** consulta e exporta (Excel, CSV, PDF, imagem, WhatsApp).

**Testar antes do dia da prova:** em **Admin → Simulação & testes** tens
*Criar prova de teste (20 atletas)*, *Simular prova completa* (preenche todos os tempos
automaticamente) e *Correr testes internos*.

---

## 4. Placar num ecrã (resultados ao vivo, todas as provas)

O separador **Placar** mostra as quatro provas ao mesmo tempo, com a classificação de cada
uma a atualizar em tempo real (bandeira *provisório/final*, classificados e atletas em prova).

**TV/projetor ligado por cabo ao mesmo computador (recomendado):**
1. No separador **Placar**, clica em **⛶ Abrir num ecrã (nova janela)**.
2. Arrasta essa janela para a TV e carrega em **ecrã inteiro**.
3. Cronometra normalmente na janela principal — o placar atualiza-se sozinho.

Controlos do placar: número de colunas (Auto/1/2/3), **rodar provas** (mostra uma prova
grande de cada vez, útil em ecrãs pequenos) e ecrã inteiro. Cada janela tem as suas
definições, por isso o placar na TV não interfere com a janela de cronometragem.

> A sincronização entre janelas usa o armazenamento local do navegador e funciona **offline**,
> desde que as janelas estejam no **mesmo computador/navegador**. Para um **dispositivo
> separado** (uma segunda TV com o seu próprio browser, um telemóvel de outra pessoa), é
> preciso a sincronização **Supabase** — ver secção 7.

---

## 5. Publicar online (para vários dispositivos e instalação PWA)

Qualquer alojamento de ficheiros estáticos serve. Opções simples e gratuitas:

**Netlify (arrastar e largar)**
1. Entra em https://app.netlify.com/drop
2. Arrasta a pasta `hyrox-timer` inteira.
3. Recebes um endereço `https://…netlify.app` — abre-o em todos os dispositivos.

**GitHub Pages**
1. Cria um repositório e envia o conteúdo da pasta.
2. *Settings → Pages → Deploy from branch* (`main`, `/root`).
3. Usa o endereço `https://<utilizador>.github.io/<repo>/`.

**Servir localmente na rede da box (sem internet)**
```bash
cd hyrox-timer
python3 -m http.server 8080
# nos outros dispositivos (mesma rede Wi-Fi): http://IP-DO-PC:8080
```

---

## 6. Instalar como aplicação (PWA)

Depois de abrir o endereço `https://…` (ponto 4):

- **Android / Chrome:** menu ⋮ → *Instalar aplicação* / *Adicionar ao ecrã principal*.
- **iPhone / Safari:** botão Partilhar → *Adicionar ao ecrã principal*.
- **Computador / Chrome / Edge:** ícone de instalação na barra de endereço.

Fica com ícone próprio (o **V** da CrossFit Viseu) e abre em ecrã inteiro, também **offline**.

---

## 7. Resultados noutro ecrã / TV em tempo real

Há duas situações:

**Cenário A — TV ligada por cabo (HDMI) ao mesmo computador que cronometra.**
Não precisa de internet nem de configuração. Vai ao separador **Placar**, clica em
**Abrir num ecrã (nova janela)**, arrasta a janela para a TV e põe em **ecrã inteiro**.
Mostra as quatro provas ao vivo e atualiza sozinho enquanto cronometras.

**Cenário B — a TV/ecrã é um aparelho separado** (Smart TV, outro PC/tablet).
Aí é preciso ligar os dispositivos através do **Supabase** (grátis). A app já traz esta
sincronização embutida:

1. Cria um projeto em https://supabase.com
2. Abre o **SQL Editor** e executa o ficheiro **`supabase_sync.sql`** (cria a tabela `sessions`).
3. Em **Project Settings → API Keys**, copia dois valores: o **Project URL**
   (`https://xxxx.supabase.co`) e a chave **publishable** (`sb_publishable_…`).
   *(Projetos mais antigos podem mostrar em vez disso a chave **anon public** `eyJhbGci…` — também funciona.)*
4. Na app, em **Admin → Sincronização entre dispositivos**, cola o URL e a chave,
   escolhe um **Código da sessão** (ex.: `cfv-simulacao-2026`), define o **Papel** do
   dispositivo e clica em **Ligar sincronização**. Usa **Testar ligação** para confirmar.

**Papéis:** usa **um único** dispositivo em **Escrita** (o que cronometra) e todos os
outros em **Visualização** (ecrãs/TV — só recebem). O mesmo **código de sessão** liga-os.

**Atalho para a TV:** no dispositivo que cronometra, clica em **Copiar link do ecrã (TV)**.
Esse endereço já leva o URL, a chave e a sessão embutidos e abre diretamente o **placar em
modo visualização** — cola-o no browser da TV e fica logo a mostrar os resultados ao vivo.

> Modelo de sincronização: o estado da prova é guardado como um único registo por sessão,
> com revisão crescente (o mais recente prevalece). É ideal para **um** dispositivo a
> cronometrar e vários ecrãs a receber. As credenciais e o nome do operador de cada
> dispositivo ficam sempre locais — não são enviados.
>
> O ficheiro `supabase_schema.sql` (modelo relacional com registos imutáveis) fica incluído
> apenas como referência avançada; **não é necessário** para esta sincronização.

---

## 8. Testes

Em **Admin → Simulação & testes** tens três ferramentas:

- **Criar prova de teste (20 atletas):** gera atletas fictícios nas 4 provas e 2 vagas.
- **Simular prova completa:** preenche automaticamente todos os tempos (corridas, estações,
  algumas penalizações) e valida uma parte — ideal para percorrer classificações e relatórios
  antes de usar com atletas reais.
- **Correr testes internos:** verifica a lógica e mostra o resultado por grupos —
  - **Fluxo:** 8 corridas e 8 estações, estados e botão seguinte corretos em cada passo, tempo bruto e acumulado.
  - **Voltar atrás:** anulação em qualquer fase mantém a hora de partida e recalcula tudo.
  - **Penalizações:** 2:00 + 0:30 + 2×0:30 = 3:30 exatos; "sem penalizações" = tempo bruto.
  - **Validação:** resultado validado bloqueia; reabrir recalcula a classificação.
  - **Classificações/Rankings:** empates desportivos (1.º, 2.º, 2.º, 4.º), menor tempo = 1.º, só a mesma prova.
  - **Médias e ritmo, relatório individual, exportações e integridade** (sem tempos negativos, marcas sempre crescentes).

---

## 9. Segurança dos dados

- Cada clique é guardado automaticamente (atleta, ação, hora, operador, dispositivo).
- São criadas **cópias de segurança automáticas** durante a prova (12 mais recentes).
- **Nada é apagado definitivamente:** desfazer e correções ficam sempre na auditoria.
- **Admin → Cópia de segurança (JSON)** exporta tudo; *Restaurar JSON* recupera.
- Se a internet falhar, a app continua a registar localmente.

---

## 10. Notas técnicas

- Sem dependências externas nem build — HTML/CSS/JavaScript puro, pronto a abrir.
- Fonte única de tempo (`Date.now()`) para consistência dos cálculos no dispositivo.
- Excel exportado em formato SpreadsheetML (abre no Excel/LibreOffice com várias folhas).
- PDF do relatório individual gerado via impressão do navegador (*Guardar como PDF*).
- A ordem das estações é editável por prova em **Admin → Provas**.
