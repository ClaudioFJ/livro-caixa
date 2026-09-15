# Livro-Caixa · Controle de Gastos Pessoais

Aplicação web em **HTML, CSS e JavaScript puro** (sem frameworks) para
cadastrar, editar, excluir e visualizar movimentações financeiras
(entradas e saídas), com totais e saldo calculados dinamicamente.

Projeto construído seguindo a mesma estrutura de dados e organização de
código usada na To-Do List de referência da disciplina.

## Como rodar

Não há build nem dependências para instalar. Basta abrir o `index.html`
no navegador, ou servir a pasta com qualquer servidor estático:

```bash
npx serve .
# ou
python3 -m http.server 8000
```

## Estrutura dos arquivos

```
├── index.html   # marcação da página (formulário, resumo, lista, gráfico)
├── style.css    # tokens de cor/tipografia, layout e responsividade
├── script.js    # todo o comportamento: dados, validação, CRUD e render
└── README.md
```

## Estrutura de dados

Cada movimentação é representada por um **objeto simples**, guardado em
um **array** (`movimentacoes`), o mesmo padrão do array de tarefas na
To-Do List:

```js
{
  id: "mov-1734022345-a1b2c3",
  tipo: "entrada" | "saida",
  descricao: "Salário",
  categoria: "Salário",
  conta: "Conta Corrente" | "Poupança" | "Investimentos" | "Carteira",
  valor: 3500,
  data: "2026-09-08T13:45:00.000Z"
}
```

A watchlist de investimentos segue o mesmo espírito, mas mais simples —
um array de strings persistido à parte:

```js
watchlist = ["PETR4.SA", "AAPL"];
```

As cotações em si (`cotacoes`) **não são persistidas**: são dados vivos,
buscados de novo a cada vez que a página carrega, guardados só em memória
no formato `{ [ticker]: { preco, variacaoPct, historico, carregando, erro } }`.

O array inteiro é persistido em `localStorage` (`JSON.stringify` /
`JSON.parse`) a cada alteração, então os dados sobrevivem a um F5 ou ao
fechar o navegador.

## Por que o array nunca é alterado "no lugar"

Em nenhum momento o código usa `push`, `splice` ou atribuição direta a
uma posição do array (`array[i] = ...`). Sempre que o estado muda, uma
**nova referência de array** é criada. Isso deixa o fluxo de dados
previsível (o mesmo princípio de imutabilidade usado na To-Do List) e é
o que possibilita usar `map`/`filter`/`reduce` de forma limpa.

## Onde cada técnica pedida aparece no `script.js`

| Técnica | Onde | Para quê |
|---|---|---|
| **`map()`** | `movimentacoes.map(...)` no submit do formulário | Ao editar, percorre o array e substitui só o objeto cujo `id` bate, mantendo os demais intactos |
| **`map()`** | `lista.map(criarItemHTML).join('')` em `renderizarLista` | Transforma cada objeto de movimentação em uma string HTML antes de inserir na tela |
| **`filter()`** | `movimentacoes.filter(mov => mov.id !== id)` | Exclusão: gera um novo array sem o item removido |
| **`filter()`** | `filtrarMovimentacoes` | Filtro por tipo (entrada/saída) e por texto de busca, em cadeia (`.filter().filter()`) |
| **`filter()`** | `agruparSaidasPorCategoria` | Isola só as saídas antes de agrupar por categoria para o gráfico |
| **`reduce()`** | `calcularTotais` | Soma entradas e saídas em uma única passada, devolvendo `{ entradas, saidas }` |
| **`reduce()`** | `agruparSaidasPorCategoria` | Transforma o array de saídas em um objeto `{ categoria: totalGasto }` para o Chart.js |
| **Spread Operator** | `{ ...mov, ...dadosFormulario }` | Cria um objeto novo na edição, preservando `id`/`data` originais e sobrescrevendo o resto |
| **Spread Operator** | `[...movimentacoes, novaMovimentacao]` | Adiciona um item novo sem mutar o array original |
| **Spread Operator** | `{ ...acumulador, [chave]: ... }` dentro dos `reduce` | Evita mutar o acumulador a cada iteração |
| **Arrow functions** | Praticamente todas as funções do arquivo (`const nome = (parametros) => {...}`) | Padrão de escrita adotado em todo o projeto, igual à To-Do List |
| **Funções puras** | `validarMovimentacao`, `calcularTotais`, `formatarMoeda`, `filtrarMovimentacoes` | Recebem dados e devolvem dados, sem tocar no DOM — fáceis de ler e testar isoladamente |
| **Delegação de evento** | `els.lista.addEventListener('click', ...)` e `els.listaWatchlist.addEventListener('click', ...)` | Um único listener no `<ul>` trata clique em "editar"/"excluir" (ou "gráfico"/"atualizar"/"remover", na watchlist) de qualquer item, mesmo os criados depois |
| **`async`/`await` + `fetch`** | `buscarCotacaoYahoo`, `atualizarCotacao` | Busca a cotação do ativo no Yahoo Finance sem travar a interface enquanto espera a resposta |
| **`reduce()`** | `agruparPorMes` | Agrupa entradas e saídas por mês num objeto `{ "2026-09": { entradas, saidas } }`, para o gráfico de barras |

## Organização das responsabilidades

O `script.js` é dividido em seções numeradas, na seguinte ordem de
dependência:

1. **Estado** — variáveis (`movimentacoes`, `idEmEdicao`, `tipoSelecionado`) e referências ao DOM.
2. **Persistência** — `carregarMovimentacoes` / `salvarMovimentacoes` (localStorage).
3. **Regras de negócio puras** — validação, cálculo de totais, filtros e agrupamento. Nada aqui mexe na tela.
4. **Renderização** — funções que leem o estado e atualizam o DOM (`renderizarLista`, `renderizarResumo`, `renderizarGrafico`, `atualizarTela`).
5. **Manipuladores de evento** — ligam a interação do usuário (submit, cliques, filtros, tema) às funções acima.
6. **Inicialização** — carrega dados salvos e faz a primeira renderização.

Essa separação (dados → regras → tela → eventos) é a mesma lógica usada
na To-Do List: qualquer alteração de estado passa pelas funções da
seção 3, e a tela só é redesenhada por completo através de `atualizarTela()`.

## Requisitos atendidos

- [x] Cadastrar movimentação (entrada ou saída)
- [x] Descrição, categoria e valor
- [x] Editar movimentação existente
- [x] Excluir movimentação
- [x] Listar movimentações
- [x] Total de entradas, total de saídas e saldo final
- [x] Validação antes de cadastrar
- [x] Dados organizados em arrays e objetos
- [x] Interface atualizada dinamicamente a partir dos dados
- [x] Código organizado em funções com responsabilidade única

## Diferenciais implementados

- **`localStorage`**: os dados (movimentações, tema e watchlist de investimentos) persistem entre sessões.
- **Campo "Conta"**: cada movimentação indica se o dinheiro está/saiu de Conta Corrente, Poupança, Investimentos ou Carteira. Filtro dedicado por conta na lista.
- **Filtro por tipo, conta e texto de busca** na lista de movimentações.
- **Categorias por tipo**: o `<select>` de categoria muda conforme Entrada/Saída.
- **Gráfico de rosca (Chart.js)** com a distribuição das saídas por categoria.
- **Gráfico de barras (Chart.js)** comparando entradas x saídas mês a mês.
- **Investimentos (Yahoo Finance)**: painel para acompanhar cotações reais de ações/fundos (ex.: `PETR4.SA`, `AAPL`) com preço, variação percentual e gráfico de linha do histórico de 1 mês (Chart.js).
- **Dark mode**, com preferência salva no `localStorage`.
- **Responsividade**: layout em duas colunas no desktop e empilhado no celular, com a tabela virando "cartões" em telas pequenas.

### Sobre a integração com Yahoo Finance

A API pública do Yahoo Finance (`query1.finance.yahoo.com`) não libera CORS
para chamadas feitas direto do navegador. Como esta é uma aplicação
100% front-end (sem backend), a chamada é feita através de **proxies CORS
públicos**, com fallback automático — se um estiver fora do ar ou mudar de
política (o que acontece com frequência nesse tipo de serviço gratuito), o
código tenta o próximo da lista antes de desistir:

```js
const PROXIES_CORS = [
  (urlAlvo) => `https://api.allorigins.win/raw?url=${encodeURIComponent(urlAlvo)}`,
  (urlAlvo) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(urlAlvo)}`,
  (urlAlvo) => `https://corsproxy.io/?url=${encodeURIComponent(urlAlvo)}`,
];
```

Isso é suficiente para fins pessoais/acadêmicos, mas **não é recomendado
para um projeto em produção** — nesse cenário o correto é ter um pequeno
backend próprio fazendo essa chamada (evitando depender de proxies
públicos de terceiros, que podem ficar fora do ar ou mudar de
comportamento sem aviso — o que já aconteceu durante o desenvolvimento
deste projeto).

Novas técnicas de JS usadas nessa parte:
- **`async`/`await`** e **`fetch`** para buscar dados externos sem travar a interface.
- **`try/catch` dentro de um `for...of`** (`buscarComFallbackDeProxy`) para tentar vários proxies em sequência até um dar certo.
- **`try/catch`** para tratar erros de rede ou ticker inválido e mostrar isso ao usuário.
- **Destructuring com renomeação e rest** (`const { [ticker]: _removido, ...restante } = cotacoes`) para remover uma chave de um objeto sem mutá-lo, ao excluir um ativo da watchlist.

> Tickers de índices usam `^` na frente: `^BVSP` (Ibovespa), `^GSPC` (S&P 500), `^VIX`.

## Protótipo (Figma)

> Adicione aqui o link do protótipo de Figma usado para planejar o
> fluxo e o layout antes da implementação, por exemplo:
> `https://www.figma.com/file/xxxxxxx/livro-caixa`

## Autor

> Nome do aluno / turma — preencher antes da entrega.
