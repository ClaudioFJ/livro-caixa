/* ==========================================================================
   LIVRO-CAIXA — controle de gastos pessoais
   ==========================================================================
   Organização do arquivo (mesma lógica usada na To-Do List de referência):
   1. Estado da aplicação (as "fontes da verdade")
   2. Persistência (localStorage)
   3. Regras de negócio puras (validar, calcular, filtrar)
   4. Funções de renderização (estado -> tela)
   5. Manipuladores de evento (tela -> estado)
   6. Inicialização

   Cada movimentação é um OBJETO:
   { id, tipo: 'entrada' | 'saida', descricao, categoria, valor, data }

   O conjunto de movimentações é sempre um NOVO ARRAY a cada alteração
   (nunca usamos push/splice diretamente no array de estado) — isso é
   o que permite usar map/filter/reduce e Spread Operator de forma
   previsível, exatamente como na To-Do List.
   ========================================================================== */

// ---------------------------------------------------------------------------
// 1. ESTADO DA APLICAÇÃO
// ---------------------------------------------------------------------------
const CHAVE_LOCALSTORAGE = 'livro-caixa:movimentacoes';
const CHAVE_TEMA = 'livro-caixa:tema';
const CHAVE_WATCHLIST = 'livro-caixa:watchlist';

let movimentacoes = [];      // array de objetos: os dados da aplicação
let idEmEdicao = null;       // null = cadastrando; string = editando esse id
let tipoSelecionado = 'entrada'; // controla o segmentado Entrada/Saída
let graficoCategorias = null;    // instância do Chart.js (para poder destruir/recriar)
let graficoMensal = null;        // instância do gráfico de barras (entradas x saídas por mês)
let graficoInvestimento = null;  // instância do gráfico de linha do ativo selecionado

// Categorias disponíveis por tipo — usado para trocar o <optgroup> visível
const CATEGORIAS = {
  entrada: ['Salário', 'Freelance', 'Investimentos', 'Outras entradas'],
  saida: ['Alimentação', 'Moradia', 'Transporte', 'Lazer', 'Saúde', 'Educação', 'Outras saídas'],
};

// --- Investimentos (Yahoo Finance) ---------------------------------------
let watchlist = [];        // array de strings: os tickers acompanhados, ex.: "PETR4.SA"
let cotacoes = {};         // objeto em memória: { ticker: { preco, variacaoPct, historico, carregando, erro } }
let tickerSelecionado = null; // ticker cujo gráfico de histórico está sendo exibido

// A API pública do Yahoo Finance não libera CORS para chamadas feitas
// direto do navegador. Por isso passamos a URL por um proxy CORS público
// antes de chegar no Yahoo. Proxies gratuitos caem ou mudam de política com
// frequência, então mantemos uma LISTA e tentamos um por um (fallback) —
// isso é suficiente para uso pessoal/acadêmico, mas não é recomendado para
// produção; o ideal nesse caso é ter um pequeno backend próprio.
const YAHOO_FINANCE_URL = (ticker) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;

const PROXIES_CORS = [
  (urlAlvo) => `https://api.allorigins.win/raw?url=${encodeURIComponent(urlAlvo)}`,
  (urlAlvo) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(urlAlvo)}`,
  (urlAlvo) => `https://corsproxy.io/?url=${encodeURIComponent(urlAlvo)}`,
];

/**
 * Tenta buscar `urlAlvo` através de cada proxy da lista, um de cada vez.
 * Assim que um proxy responder com sucesso, o resultado (já em JSON) é
 * devolvido — os proxies seguintes nem chegam a ser chamados. Só lança
 * erro se TODOS falharem.
 */
const buscarComFallbackDeProxy = async (urlAlvo) => {
  let ultimoErro = new Error('Nenhum proxy configurado.');
  for (const construirUrlProxy of PROXIES_CORS) {
    try {
      const resposta = await fetch(construirUrlProxy(urlAlvo));
      if (!resposta.ok) throw new Error(`resposta ${resposta.status}`);
      return await resposta.json();
    } catch (erro) {
      ultimoErro = erro; // guarda o erro e tenta o próximo proxy da lista
    }
  }
  throw new Error(`Não foi possível consultar a cotação (todos os proxies falharam: ${ultimoErro.message}).`);
};

// Referências aos elementos usados várias vezes
const els = {
  form: document.getElementById('formMovimentacao'),
  inputId: document.getElementById('movimentacaoId'),
  inputDescricao: document.getElementById('descricao'),
  inputCategoria: document.getElementById('categoria'),
  inputValor: document.getElementById('valor'),
  grupoEntradas: document.getElementById('grupoEntradas'),
  grupoSaidas: document.getElementById('grupoSaidas'),
  mensagemErro: document.getElementById('mensagemErro'),
  tituloFormulario: document.getElementById('tituloFormulario'),
  btnSalvar: document.getElementById('btnSalvar'),
  btnCancelar: document.getElementById('btnCancelar'),
  segmentado: document.querySelectorAll('.segmentado__opcao'),
  lista: document.getElementById('listaMovimentacoes'),
  listaVazia: document.getElementById('listaVazia'),
  totalEntradas: document.getElementById('totalEntradas'),
  totalSaidas: document.getElementById('totalSaidas'),
  saldoFinal: document.getElementById('saldoFinal'),
  filtroTipo: document.getElementById('filtroTipo'),
  filtroConta: document.getElementById('filtroConta'),
  filtroBusca: document.getElementById('filtroBusca'),
  btnTema: document.getElementById('btnTema'),
  canvasGrafico: document.getElementById('graficoCategorias'),
  graficoVazio: document.getElementById('graficoVazio'),
  canvasGraficoMensal: document.getElementById('graficoMensal'),
  graficoMensalVazio: document.getElementById('graficoMensalVazio'),
  inputConta: document.getElementById('conta'),
  // Investimentos
  formTicker: document.getElementById('formTicker'),
  inputTicker: document.getElementById('inputTicker'),
  mensagemErroTicker: document.getElementById('mensagemErroTicker'),
  listaWatchlist: document.getElementById('listaWatchlist'),
  watchlistVazia: document.getElementById('watchlistVazia'),
  caixaGraficoInvestimento: document.getElementById('caixaGraficoInvestimento'),
  tituloGraficoInvestimento: document.getElementById('tituloGraficoInvestimento'),
  canvasGraficoInvestimento: document.getElementById('graficoInvestimento'),
};

// ---------------------------------------------------------------------------
// 2. PERSISTÊNCIA (localStorage) — diferencial pedido no enunciado
// ---------------------------------------------------------------------------
const carregarMovimentacoes = () => {
  const dadosSalvos = localStorage.getItem(CHAVE_LOCALSTORAGE);
  return dadosSalvos ? JSON.parse(dadosSalvos) : [];
};

const salvarMovimentacoes = () => {
  localStorage.setItem(CHAVE_LOCALSTORAGE, JSON.stringify(movimentacoes));
};

// ---------------------------------------------------------------------------
// 3. REGRAS DE NEGÓCIO PURAS
//    (recebem dados, devolvem dados — não tocam no DOM)
// ---------------------------------------------------------------------------

// Gera um identificador único simples, sem depender de bibliotecas externas.
const gerarId = () => `mov-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

// Formata número para moeda brasileira.
const formatarMoeda = (valor) =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Formata a data ISO salva no objeto para o padrão dd/mm/aaaa.
const formatarData = (isoString) => new Date(isoString).toLocaleDateString('pt-BR');

/**
 * Valida os dados vindos do formulário.
 * Retorna uma string com a mensagem de erro, ou null quando está tudo certo.
 * Mantida pura (não mexe no DOM) para poder ser testada isoladamente.
 */
const validarMovimentacao = ({ descricao, categoria, valor, conta }) => {
  if (!descricao || descricao.trim().length < 2) {
    return 'Informe uma descrição com pelo menos 2 caracteres.';
  }
  if (!categoria) {
    return 'Selecione uma categoria.';
  }
  if (!conta) {
    return 'Selecione a conta (Poupança, Conta Corrente, Investimentos ou Carteira).';
  }
  const valorNumerico = Number(valor);
  if (!valor || Number.isNaN(valorNumerico) || valorNumerico <= 0) {
    return 'Informe um valor numérico maior que zero.';
  }
  return null;
};

/**
 * Calcula os totais de entradas, saídas e saldo a partir de uma lista.
 * Usa REDUCE: percorre o array e vai "acumulando" um único objeto de saída.
 * O Spread Operator (...acumulador) evita mutar o acumulador a cada passo.
 */
const calcularTotais = (lista) =>
  lista.reduce(
    (acumulador, mov) => {
      const chave = mov.tipo === 'entrada' ? 'entradas' : 'saidas';
      return { ...acumulador, [chave]: acumulador[chave] + mov.valor };
    },
    { entradas: 0, saidas: 0 }
  );

/**
 * Aplica os filtros de tipo e de texto de busca sobre o array de movimentações.
 * Usa FILTER duas vezes em sequência (encadeamento de métodos de array).
 */
const filtrarMovimentacoes = (lista, { tipo, conta, busca }) =>
  lista
    .filter((mov) => tipo === 'todos' || mov.tipo === tipo)
    .filter((mov) => conta === 'todas' || mov.conta === conta)
    .filter((mov) => mov.descricao.toLowerCase().includes(busca.trim().toLowerCase()));

/**
 * Agrupa o valor total de SAÍDAS por categoria, para alimentar o gráfico.
 * Usa REDUCE para transformar um array de objetos em um único objeto
 * no formato { categoria: totalGasto }.
 */
const agruparSaidasPorCategoria = (lista) =>
  lista
    .filter((mov) => mov.tipo === 'saida')
    .reduce((acumulador, mov) => {
      const totalAtual = acumulador[mov.categoria] || 0;
      return { ...acumulador, [mov.categoria]: totalAtual + mov.valor };
    }, {});

/**
 * Agrupa entradas e saídas por mês (formato "aaaa-mm"), para o gráfico de barras.
 * Usa REDUCE de novo, mas agora o acumulador é um objeto de objetos:
 * { "2026-01": { entradas: 100, saidas: 40 }, "2026-02": { ... } }
 */
const agruparPorMes = (lista) =>
  lista.reduce((acumulador, mov) => {
    const mes = mov.data.slice(0, 7); // "2026-09-08T..." -> "2026-09"
    const totaisDoMes = acumulador[mes] || { entradas: 0, saidas: 0 };
    const chave = mov.tipo === 'entrada' ? 'entradas' : 'saidas';
    return {
      ...acumulador,
      [mes]: { ...totaisDoMes, [chave]: totaisDoMes[chave] + mov.valor },
    };
  }, {});

// Transforma "2026-09" em "set/26", só para exibir no eixo do gráfico.
const formatarRotuloMes = (mesIso) => {
  const [ano, mes] = mesIso.split('-');
  const data = new Date(Number(ano), Number(mes) - 1, 1);
  return data.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
};

// ---------------------------------------------------------------------------
// 4. RENDERIZAÇÃO (estado -> tela)
// ---------------------------------------------------------------------------

// Constrói o HTML de UM item da lista. Função pura: objeto entra, string sai.
const criarItemHTML = (mov) => `
  <li class="item-movimentacao item-movimentacao--${mov.tipo}" data-id="${mov.id}">
    <span class="item-movimentacao__descricao">${mov.descricao}</span>
    <span class="item-movimentacao__categoria">${mov.categoria}</span>
    <span class="item-movimentacao__conta">${mov.conta}</span>
    <span class="item-movimentacao__data">${formatarData(mov.data)}</span>
    <span class="item-movimentacao__valor">${mov.tipo === 'entrada' ? '+' : '-'} ${formatarMoeda(mov.valor)}</span>
    <span class="item-movimentacao__acoes">
      <button class="botao-icone" type="button" data-acao="editar" data-id="${mov.id}" aria-label="Editar">✎</button>
      <button class="botao-icone" type="button" data-acao="excluir" data-id="${mov.id}" aria-label="Excluir">✕</button>
    </span>
  </li>
`;

/**
 * Renderiza a lista inteira na tela.
 * Usa MAP para transformar cada objeto de movimentação em uma string HTML,
 * e join('') para juntar tudo antes de um único innerHTML (mais performático
 * do que inserir elemento por elemento).
 */
const renderizarLista = (lista) => {
  els.lista.innerHTML = lista.map(criarItemHTML).join('');
  els.listaVazia.hidden = lista.length > 0;
};

// Atualiza os três totais exibidos no topo da página.
const renderizarResumo = () => {
  const { entradas, saidas } = calcularTotais(movimentacoes);
  const saldo = entradas - saidas;

  els.totalEntradas.textContent = formatarMoeda(entradas);
  els.totalSaidas.textContent = formatarMoeda(saidas);
  els.saldoFinal.textContent = formatarMoeda(saldo);
  els.saldoFinal.style.color = saldo < 0 ? 'var(--cor-saida)' : 'var(--cor-destaque)';
};

// Preenche o <select> de categorias de acordo com o tipo (entrada/saída) ativo.
const renderizarCategoriasDisponiveis = () => {
  els.grupoEntradas.hidden = tipoSelecionado !== 'entrada';
  els.grupoSaidas.hidden = tipoSelecionado !== 'saida';

  const categoriaAtual = els.inputCategoria.value;
  const categoriasValidas = CATEGORIAS[tipoSelecionado];
  if (!categoriasValidas.includes(categoriaAtual)) {
    els.inputCategoria.value = '';
  }
};

// Desenha (ou atualiza) o gráfico de pizza de saídas por categoria via Chart.js.
const renderizarGrafico = () => {
  const agrupado = agruparSaidasPorCategoria(movimentacoes);
  const categorias = Object.keys(agrupado);
  const valores = Object.values(agrupado);

  els.graficoVazio.hidden = categorias.length > 0;
  els.canvasGrafico.hidden = categorias.length === 0;

  if (graficoCategorias) {
    graficoCategorias.destroy();
  }
  if (categorias.length === 0) return;

  graficoCategorias = new Chart(els.canvasGrafico, {
    type: 'doughnut',
    data: {
      labels: categorias,
      datasets: [{
        data: valores,
        backgroundColor: ['#A6472F', '#B08A22', '#1C2B2A', '#55635F', '#C9CFC5', '#E08064', '#4FBF8F'],
        borderWidth: 0,
      }],
    },
    options: {
      plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } } },
      cutout: '62%',
    },
  });
};

// Desenha (ou atualiza) o gráfico de barras comparando entradas x saídas, mês a mês.
const renderizarGraficoMensal = () => {
  const agrupado = agruparPorMes(movimentacoes);
  const meses = Object.keys(agrupado).sort(); // "aaaa-mm" ordena certo como texto

  els.graficoMensalVazio.hidden = meses.length > 0;
  els.canvasGraficoMensal.hidden = meses.length === 0;

  if (graficoMensal) {
    graficoMensal.destroy();
  }
  if (meses.length === 0) return;

  const totaisEntradas = meses.map((mes) => agrupado[mes].entradas);
  const totaisSaidas = meses.map((mes) => agrupado[mes].saidas);

  graficoMensal = new Chart(els.canvasGraficoMensal, {
    type: 'bar',
    data: {
      labels: meses.map(formatarRotuloMes),
      datasets: [
        { label: 'Entradas', data: totaisEntradas, backgroundColor: '#1F7A5C', borderRadius: 3 },
        { label: 'Saídas', data: totaisSaidas, backgroundColor: '#A6472F', borderRadius: 3 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (valor) => formatarMoeda(valor) } },
      },
    },
  });
};

// Função "guarda-chuva": aplica o filtro atual e redesenha lista + resumo + gráficos.
const atualizarTela = () => {
  const listaFiltrada = filtrarMovimentacoes(movimentacoes, {
    tipo: els.filtroTipo.value,
    conta: els.filtroConta.value,
    busca: els.filtroBusca.value,
  });
  renderizarLista(listaFiltrada);
  renderizarResumo();
  renderizarGrafico();
  renderizarGraficoMensal();
};

// ---------------------------------------------------------------------------
// 5. MANIPULADORES DE EVENTO (tela -> estado)
// ---------------------------------------------------------------------------

// Alterna entre "Entrada" e "Saída" no segmentado do formulário.
els.segmentado.forEach((botao) => {
  botao.addEventListener('click', () => {
    tipoSelecionado = botao.dataset.tipo;
    els.segmentado.forEach((b) => b.classList.toggle('is-ativo', b === botao));
    renderizarCategoriasDisponiveis();
  });
});

// Envio do formulário: tanto para CADASTRAR quanto para EDITAR.
els.form.addEventListener('submit', (evento) => {
  evento.preventDefault();

  const dadosFormulario = {
    tipo: tipoSelecionado,
    descricao: els.inputDescricao.value,
    categoria: els.inputCategoria.value,
    valor: Number(els.inputValor.value),
    conta: els.inputConta.value,
  };

  const erro = validarMovimentacao(dadosFormulario);
  if (erro) {
    els.mensagemErro.textContent = erro;
    els.mensagemErro.hidden = false;
    return;
  }
  els.mensagemErro.hidden = true;

  if (idEmEdicao) {
    // EDIÇÃO: usamos MAP para percorrer o array e substituir apenas o item
    // cujo id bate com o que está em edição. O Spread Operator ({...mov, ...dados})
    // cria um objeto NOVO, mantendo o id e a data originais e sobrescrevendo o resto.
    movimentacoes = movimentacoes.map((mov) =>
      mov.id === idEmEdicao ? { ...mov, ...dadosFormulario } : mov
    );
  } else {
    // CADASTRO: usamos Spread Operator para criar um NOVO array contendo
    // tudo que já existia mais o novo objeto no final — sem usar push().
    const novaMovimentacao = { id: gerarId(), ...dadosFormulario, data: new Date().toISOString() };
    movimentacoes = [...movimentacoes, novaMovimentacao];
  }

  salvarMovimentacoes();
  encerrarEdicao();
  atualizarTela();
});

// Clique na lista (delegação de evento): trata tanto "editar" quanto "excluir".
els.lista.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;

  const { acao, id } = botao.dataset;

  if (acao === 'excluir') {
    // EXCLUSÃO: usamos FILTER para gerar um novo array sem o item com esse id.
    movimentacoes = movimentacoes.filter((mov) => mov.id !== id);
    salvarMovimentacoes();
    atualizarTela();
  }

  if (acao === 'editar') {
    // find() localiza o objeto original para preencher o formulário.
    const movimentacao = movimentacoes.find((mov) => mov.id === id);
    if (movimentacao) iniciarEdicao(movimentacao);
  }
});

// Preenche o formulário com os dados de uma movimentação para edição.
const iniciarEdicao = (movimentacao) => {
  idEmEdicao = movimentacao.id;
  tipoSelecionado = movimentacao.tipo;

  els.segmentado.forEach((b) => b.classList.toggle('is-ativo', b.dataset.tipo === movimentacao.tipo));
  renderizarCategoriasDisponiveis();

  els.inputId.value = movimentacao.id;
  els.inputDescricao.value = movimentacao.descricao;
  els.inputCategoria.value = movimentacao.categoria;
  els.inputValor.value = movimentacao.valor;
  els.inputConta.value = movimentacao.conta;

  els.tituloFormulario.textContent = 'Editar movimentação';
  els.btnSalvar.textContent = 'Salvar alterações';
  els.btnCancelar.hidden = false;

  els.inputDescricao.focus();
};

// Sai do modo de edição e devolve o formulário ao estado de cadastro.
const encerrarEdicao = () => {
  idEmEdicao = null;
  els.form.reset();
  els.tituloFormulario.textContent = 'Nova movimentação';
  els.btnSalvar.textContent = 'Adicionar movimentação';
  els.btnCancelar.hidden = true;
};

els.btnCancelar.addEventListener('click', encerrarEdicao);

// Filtros por tipo, conta e texto atualizam a tela em tempo real.
els.filtroTipo.addEventListener('change', atualizarTela);
els.filtroConta.addEventListener('change', atualizarTela);
els.filtroBusca.addEventListener('input', atualizarTela);

// Alternância de tema claro/escuro, também persistida no localStorage.
els.btnTema.addEventListener('click', () => {
  const temaAtual = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(temaAtual);
});

const aplicarTema = (tema) => {
  document.documentElement.dataset.tema = tema === 'escuro' ? 'escuro' : '';
  localStorage.setItem(CHAVE_TEMA, tema);
  // Redesenha os gráficos já existentes para acompanhar as cores do novo tema.
  if (graficoCategorias) renderizarGrafico();
  if (graficoMensal) renderizarGraficoMensal();
  if (graficoInvestimento) renderizarGraficoInvestimento();
};

// ---------------------------------------------------------------------------
// 5b. INVESTIMENTOS — cotações reais via Yahoo Finance
// ---------------------------------------------------------------------------

// Persistência da lista de tickers acompanhados (igual ao padrão usado
// para as movimentações: string <-> array via JSON).
const carregarWatchlist = () => {
  const dadosSalvos = localStorage.getItem(CHAVE_WATCHLIST);
  return dadosSalvos ? JSON.parse(dadosSalvos) : [];
};
const salvarWatchlist = () => {
  localStorage.setItem(CHAVE_WATCHLIST, JSON.stringify(watchlist));
};

/**
 * Busca a cotação de um ticker no Yahoo Finance (via proxy CORS) e devolve
 * um objeto no formato { preco, variacaoPct, historico }.
 * Função assíncrona pura: recebe um ticker, devolve uma Promise com o dado —
 * não mexe em `cotacoes` nem no DOM diretamente.
 */
const buscarCotacaoYahoo = async (ticker) => {
  const dados = await buscarComFallbackDeProxy(YAHOO_FINANCE_URL(ticker));
  const resultado = dados?.chart?.result?.[0];
  if (!resultado) throw new Error('Ticker não encontrado.');

  const { meta, timestamp = [], indicators } = resultado;
  const fechamentos = indicators?.quote?.[0]?.close || [];
  const precoAtual = meta.regularMarketPrice;
  const fechamentoAnterior = meta.previousClose ?? meta.chartPreviousClose ?? precoAtual;
  const variacaoPct = ((precoAtual - fechamentoAnterior) / fechamentoAnterior) * 100;

  // map: cada timestamp + fechamento vira um ponto { data, fechamento };
  // filter: descarta dias sem pregão (fechamento nulo).
  const historico = timestamp
    .map((ts, indice) => ({
      data: new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      fechamento: fechamentos[indice],
    }))
    .filter((ponto) => typeof ponto.fechamento === 'number');

  return { preco: precoAtual, variacaoPct, historico };
};

// Busca a cotação de um ticker, guarda o resultado (ou erro) em `cotacoes`
// e redesenha só a watchlist — sem travar a tela enquanto a rede responde.
const atualizarCotacao = async (ticker) => {
  cotacoes = { ...cotacoes, [ticker]: { ...cotacoes[ticker], carregando: true, erro: null } };
  renderizarWatchlist();

  try {
    const dado = await buscarCotacaoYahoo(ticker);
    cotacoes = { ...cotacoes, [ticker]: { ...dado, carregando: false, erro: null } };
  } catch (erro) {
    cotacoes = {
      ...cotacoes,
      [ticker]: { ...cotacoes[ticker], carregando: false, erro: erro.message },
    };
  }
  renderizarWatchlist();
  if (tickerSelecionado === ticker) renderizarGraficoInvestimento();
};

// Constrói o HTML de um item da watchlist a partir do ticker e do que já
// sabemos sobre ele em `cotacoes` (pode ainda estar carregando).
const criarItemAtivoHTML = (ticker) => {
  const info = cotacoes[ticker];

  let colunaPreco = '<span class="item-ativo__status">carregando...</span>';
  let colunaVariacao = '';
  if (info && !info.carregando) {
    if (info.erro) {
      colunaPreco = `<span class="item-ativo__status">${info.erro}</span>`;
    } else {
      const sinal = info.variacaoPct >= 0 ? '+' : '';
      const classeVariacao = info.variacaoPct >= 0 ? 'positiva' : 'negativa';
      colunaPreco = `<span class="item-ativo__preco">${formatarMoeda(info.preco)}</span>`;
      colunaVariacao = `<span class="item-ativo__variacao item-ativo__variacao--${classeVariacao}">${sinal}${info.variacaoPct.toFixed(2)}%</span>`;
    }
  }

  return `
    <li class="item-ativo" data-ticker="${ticker}">
      <span class="item-ativo__ticker">${ticker}</span>
      ${colunaPreco}
      ${colunaVariacao}
      <span class="item-ativo__acoes">
        <button class="botao-icone" type="button" data-acao-ativo="grafico" data-ticker="${ticker}" aria-label="Ver histórico">📈</button>
        <button class="botao-icone" type="button" data-acao-ativo="atualizar" data-ticker="${ticker}" aria-label="Atualizar cotação">↻</button>
        <button class="botao-icone" type="button" data-acao-ativo="remover" data-ticker="${ticker}" aria-label="Remover">✕</button>
      </span>
    </li>
  `;
};

// Redesenha a lista de ativos acompanhados. Mesmo padrão de `renderizarLista`:
// map() transforma cada ticker em HTML, join('') junta tudo num innerJTML só.
const renderizarWatchlist = () => {
  els.listaWatchlist.innerHTML = watchlist.map(criarItemAtivoHTML).join('');
  els.watchlistVazia.hidden = watchlist.length > 0;
};

// Desenha o gráfico de linha com o histórico (1 mês) do ativo selecionado.
const renderizarGraficoInvestimento = () => {
  const info = cotacoes[tickerSelecionado];
  if (graficoInvestimento) graficoInvestimento.destroy();
  if (!info || info.carregando || info.erro || !info.historico?.length) {
    els.caixaGraficoInvestimento.hidden = true;
    return;
  }

  els.caixaGraficoInvestimento.hidden = false;
  els.tituloGraficoInvestimento.textContent = `${tickerSelecionado} · últimos 30 dias`;

  graficoInvestimento = new Chart(els.canvasGraficoInvestimento, {
    type: 'line',
    data: {
      labels: info.historico.map((ponto) => ponto.data),
      datasets: [{
        label: tickerSelecionado,
        data: info.historico.map((ponto) => ponto.fechamento),
        borderColor: '#B08A22',
        backgroundColor: 'rgba(176, 138, 34, 0.15)',
        tension: 0.25,
        fill: true,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (valor) => formatarMoeda(valor) } } },
    },
  });
};

// Envio do formulário de novo ticker.
els.formTicker.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const ticker = els.inputTicker.value.trim().toUpperCase();

  if (!ticker) {
    els.mensagemErroTicker.textContent = 'Informe um ticker, ex.: PETR4.SA ou AAPL.';
    els.mensagemErroTicker.hidden = false;
    return;
  }
  if (watchlist.includes(ticker)) {
    els.mensagemErroTicker.textContent = 'Esse ativo já está na sua lista.';
    els.mensagemErroTicker.hidden = false;
    return;
  }
  els.mensagemErroTicker.hidden = true;

  // Spread Operator: novo array com tudo que já existia + o ticker novo.
  watchlist = [...watchlist, ticker];
  salvarWatchlist();
  els.formTicker.reset();
  renderizarWatchlist();
  atualizarCotacao(ticker);
});

// Delegação de evento: um único listener trata "ver gráfico", "atualizar"
// e "remover" de qualquer item da watchlist, incluindo os criados depois.
els.listaWatchlist.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-acao-ativo]');
  if (!botao) return;
  const { acaoAtivo, ticker } = botao.dataset;

  if (acaoAtivo === 'remover') {
    watchlist = watchlist.filter((t) => t !== ticker);
    const { [ticker]: _removido, ...restante } = cotacoes; // remove a chave do objeto sem mutar
    cotacoes = restante;
    if (tickerSelecionado === ticker) {
      tickerSelecionado = null;
      renderizarGraficoInvestimento();
    }
    salvarWatchlist();
    renderizarWatchlist();
  }

  if (acaoAtivo === 'atualizar') {
    atualizarCotacao(ticker);
  }

  if (acaoAtivo === 'grafico') {
    tickerSelecionado = ticker;
    renderizarGraficoInvestimento();
  }
});

// ---------------------------------------------------------------------------
// 6. INICIALIZAÇÃO
// ---------------------------------------------------------------------------
const iniciar = () => {
  movimentacoes = carregarMovimentacoes();
  watchlist = carregarWatchlist();
  aplicarTema(localStorage.getItem(CHAVE_TEMA) || 'claro');
  renderizarCategoriasDisponiveis();
  atualizarTela();

  renderizarWatchlist();
  // busca a cotação de cada ativo salvo assim que a página carrega
  watchlist.forEach(atualizarCotacao);
};

iniciar();
