# Manual de utilização — HYROX Simulation Timer

Guia prático para o dia da prova. O mesmo conteúdo está sempre disponível dentro da app,
no separador **Ajuda**.

---

## Visão geral dos separadores

| Separador | Para que serve |
|---|---|
| **Central** | Vista principal de cronometragem: um cartão por atleta com um botão grande que muda sozinho para a próxima ação. **Roda o telemóvel para horizontal** para veres vários atletas ao mesmo tempo. |
| **Estação** | Vista por posto: escolhe a estação e regista quem entra e quem sai. Ideal para um juiz por estação. |
| **Vagas e Atletas** | Gerir vagas de partida, dar a partida (individual ou a toda a vaga), **editar atletas** e **mover atletas de vaga**. |
| **Classificações** | Classificação final, por corrida e por estação — sempre separadas por prova. |
| **Relatórios** | Relatório individual com KPIs, gráficos, pontos fortes/a melhorar e exportações. |
| **Penalizações** | Adicionar e consultar penalizações. |
| **Admin** | Dados, cópias de segurança, definições, provas, tipos de penalização, correções e testes. |
| **Ajuda** | Este manual. |

---

## Antes da prova

1. **Definições (Admin):** escreve o teu nome no campo *Operador / juiz*. Fica associado a cada registo.
2. **Atletas:** várias formas de os criar —
   - **Admin → Carregar dados de teste** (8 atletas + 2 vagas de exemplo);
   - **Admin → Criar prova de teste (20 atletas)** para um teste maior;
   - **Admin → Importar atletas CSV** (usa o `atletas_exemplo.csv` como modelo);
   - **Vagas e Atletas → + Novo atleta**, ou **+ Adicionar atleta** dentro de uma vaga.
3. **Editar e mover atletas:** em **Vagas e Atletas**, cada atleta tem **Editar atleta**
   (nome, dorsal, prova, género, categoria, vaga, hora, pista, observações) e um seletor
   na própria linha para o **mover de vaga** sem o apagar. As duas vagas atualizam de imediato.
4. **Vagas:** confirma a distribuição dos atletas pelas vagas e as horas previstas.

O ficheiro CSV usa `;` como separador e as colunas:
`Nome; Dorsal; Prova; Genero; Categoria; Vaga; Hora; Pista; Observacoes`.

---

## Dar a partida

- **Vagas → ▶ Iniciar todos:** dá a partida simultânea a todos os atletas ainda não iniciados da vaga (partida em massa).
- **Vagas → Iniciar:** dá a partida a um atleta individual.
- Enganaste-te na hora de partida? Corrige em **Admin → Corrigir registo**.

---

## Registar durante a prova

A ordem HYROX é sempre: **corrida → estação**, oito vezes, terminando nos Wall Balls.

**Modo Central (recomendado para 1 operador):**
- Cada cartão mostra o estado, o tempo acumulado, o segmento atual e a próxima ação.
- O **botão grande** alterna automaticamente entre *ENTRADA* e *SAÍDA* de cada estação —
  basta tocar no momento certo.

**Modo Estação (recomendado para vários juízes):**
- Escolhe a estação em cima.
- **A ENTRAR** (esquerda): atletas a chegar à estação — toca para registar a entrada.
- **A SAIR** (direita): atletas a terminar a estação — toca para registar a saída.

**Proteções automáticas:**
- Não deixa registar uma saída antes da entrada, nem saltar etapas.
- Ignora toques duplicados acidentais (janela de segurança de 0,35 s).

**↶ Voltar atrás** (botão separado, em qualquer fase):
- Anula **apenas o último registo** — entrada, saída, corrida seguinte ou finalização.
- Antes de anular mostra exatamente o que vais anular e para onde o atleta regressa
  (ex.: *Anular "Entrada SkiErg" de João Silva? Volta a: Corrida 1*).
- **O cronómetro continua desde a hora de partida — não reinicia.**
- O registo anulado fica guardado na auditoria e todos os tempos, médias e classificações
  são recalculados automaticamente.

---

## Penalizações e validação

- Adiciona penalizações em **Penalizações → + Adicionar penalização** ou no momento da validação.
- O total em segundos é somado ao tempo bruto para dar o **tempo final oficial**.
  O tempo bruto (cronometrado) nunca é alterado.
- Quando o atleta termina os Wall Balls, o cartão passa a **A aguardar validação**.
  Clica no botão **verde ✔ Validar resultado**: podes rever penalizações, marcar
  *sem penalizações* e fechar. Se finalizaste por engano, usa o **↶ Voltar atrás** do cartão.
- Um resultado validado fica bloqueado. Para o alterar, usa **Admin → Reabrir resultado validado**;
  ao reabrir e mudar uma penalização, a classificação é recalculada.

> O **verde** é sempre a ação de confirmar/validar. O **vermelho** fica reservado a ações
> destrutivas (eliminar, desclassificar, DNF, apagar).

---

## Estados possíveis

`Não iniciado` · `Em corrida` · `Numa estação` · `A aguardar validação` · `Resultado validado`
· `DNS` (não compareceu) · `DNF` (não terminou) · `Desclassificado`.

Os três últimos definem-se em **Admin → Alterar estado (DNS/DNF/DSQ)**.

---

## Resultados, relatórios e partilha

**Classificações** (separadas por prova):
- **Final:** tempo bruto, penalizações, tempo oficial e posição. Empates à moda desportiva (1.º, 2.º, 2.º, 4.º).
- **Corridas / Estações:** ranking de cada uma das 8 corridas e 8 estações, com melhor, média e diferenças.
- Bandeira **provisória/final** conforme os resultados já estejam todos validados.

**Relatório individual** (separador Relatórios):
- KPIs (tempo a correr, tempo em estações, ritmo médio, melhor/pior corrida, quebra na 2.ª metade).
- Tabelas completas de corridas e estações com posição e diferença para o melhor.
- Pontos fortes e pontos a melhorar, calculados automaticamente.
- Gráficos: barras das corridas, comparação com a média da prova, distribuição do tempo.
- Exportações: **PDF** (imprimir → guardar como PDF), **Excel individual**, **imagem de partilha** e **resumo WhatsApp**.

**Exportação geral** (Admin → Exportar Excel geral): livro Excel com todas as folhas —
atletas, classificação final, corridas, ritmos, posições, estações, penalizações, relatórios e histórico.

---

## Placar num ecrã (todas as provas ao vivo)

O separador **Placar** mostra as quatro provas ao mesmo tempo, cada uma com a sua
classificação a atualizar em tempo real. Para o pôr numa TV/projetor ligado por cabo ao
mesmo computador:

1. Abre o separador **Placar** e clica em **⛶ Abrir num ecrã (nova janela)**.
2. Arrasta essa nova janela para a TV e carrega em **ecrã inteiro**.
3. Continua a cronometrar na janela principal — o placar atualiza-se sozinho.

No placar podes escolher o número de colunas (Auto/1/2/3) e ativar **Rodar provas** para
mostrar uma prova grande de cada vez (bom para ecrãs mais pequenos). Cada prova mostra a
bandeira **provisório** enquanto houver resultados por validar e **final** quando estiverem
todos validados.

> Funciona offline entre janelas do **mesmo computador**. Para uma TV com o seu próprio
> browser (dispositivo separado), é preciso a sincronização Supabase — ver `README.md`.

---

## Segurança dos dados

- Gravação automática a cada ação; cópias automáticas durante a prova (12 mais recentes).
- **Admin → Cópia de segurança (JSON)** para guardar tudo num ficheiro; *Restaurar JSON* para repor.
- Tudo funciona **offline**. Os dados ficam neste dispositivo/navegador.
- Para sincronizar vários dispositivos, vê o `README.md` (secção Supabase).

---

## Resolução rápida de problemas

- **Quero treinar antes da prova real:** **Admin → Criar prova de teste (20 atletas)** e depois
  **Simular prova completa** para ver classificações e relatórios preenchidos.
- **A app fechou ou o telemóvel bloqueou a meio:** volta a abrir — cada clique foi guardado,
  o atleta continua exatamente no estado em que estava.
- **O botão de instalar app não aparece:** estás a abrir por ficheiro. Serve por `http/https` (ver README, ponto 4).
- **Não ouço o sinal sonoro:** ativa em **Admin → Definições → Som** (alguns navegadores só tocam após o primeiro toque no ecrã).
- **Preciso de acertar um tempo:** **Admin → Corrigir registo**, indica a nova hora e o motivo (fica tudo auditado).
- **Quero recomeçar:** **Admin → Apagar tudo** (faz uma cópia de segurança antes).
