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

let movimentacoes = [];      // array de objetos: os dados da aplicação
let idEmEdicao = null;       // null = cadastrando; string = editando esse id
let tipoSelecionado = 'entrada'; // controla o segmentado Entrada/Saída
let graficoCategorias = null;    // instância do Chart.js (para poder destruir/recriar)

// Categorias disponíveis por tipo — usado para trocar o <optgroup> visível
const CATEGORIAS = {
  entrada: ['Salário', 'Freelance', 'Investimentos', 'Outras entradas'],
  saida: ['Alimentação', 'Moradia', 'Transporte', 'Lazer', 'Saúde', 'Educação', 'Outras saídas'],
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
  filtroBusca: document.getElementById('filtroBusca'),
  btnTema: document.getElementById('btnTema'),
  canvasGrafico: document.getElementById('graficoCategorias'),
  graficoVazio: document.getElementById('graficoVazio'),
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
const validarMovimentacao = ({ descricao, categoria, valor }) => {
  if (!descricao || descricao.trim().length < 2) {
    return 'Informe uma descrição com pelo menos 2 caracteres.';
  }
  if (!categoria) {
    return 'Selecione uma categoria.';
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
const filtrarMovimentacoes = (lista, { tipo, busca }) =>
  lista
    .filter((mov) => tipo === 'todos' || mov.tipo === tipo)
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

// ---------------------------------------------------------------------------
// 4. RENDERIZAÇÃO (estado -> tela)
// ---------------------------------------------------------------------------

// Constrói o HTML de UM item da lista. Função pura: objeto entra, string sai.
const criarItemHTML = (mov) => `
  <li class="item-movimentacao item-movimentacao--${mov.tipo}" data-id="${mov.id}">
    <span class="item-movimentacao__descricao">${mov.descricao}</span>
    <span class="item-movimentacao__categoria">${mov.categoria}</span>
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

// Função "guarda-chuva": aplica o filtro atual e redesenha lista + resumo + gráfico.
const atualizarTela = () => {
  const listaFiltrada = filtrarMovimentacoes(movimentacoes, {
    tipo: els.filtroTipo.value,
    busca: els.filtroBusca.value,
  });
  renderizarLista(listaFiltrada);
  renderizarResumo();
  renderizarGrafico();
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

// Filtros por tipo e por texto atualizam a tela em tempo real.
els.filtroTipo.addEventListener('change', atualizarTela);
els.filtroBusca.addEventListener('input', atualizarTela);

// Alternância de tema claro/escuro, também persistida no localStorage.
els.btnTema.addEventListener('click', () => {
  const temaAtual = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(temaAtual);
});

const aplicarTema = (tema) => {
  document.documentElement.dataset.tema = tema === 'escuro' ? 'escuro' : '';
  localStorage.setItem(CHAVE_TEMA, tema);
  if (graficoCategorias) renderizarGrafico(); // redesenha com as cores do novo tema
};

// ---------------------------------------------------------------------------
// 6. INICIALIZAÇÃO
// ---------------------------------------------------------------------------
const iniciar = () => {
  movimentacoes = carregarMovimentacoes();
  aplicarTema(localStorage.getItem(CHAVE_TEMA) || 'claro');
  renderizarCategoriasDisponiveis();
  atualizarTela();
};

iniciar();
