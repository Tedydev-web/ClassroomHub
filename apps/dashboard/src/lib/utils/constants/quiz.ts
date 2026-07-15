const QUIZ_ASSET_BASE = '/assets/quiz';

export const themeImages = {
  standard: {
    card: `${QUIZ_ASSET_BASE}/standard-quiz-card.svg`,
    editor: `${QUIZ_ASSET_BASE}/standard-quiz-editor.svg`,
    play: `${QUIZ_ASSET_BASE}/standard-quiz-play.svg`
  },
  mainland: {
    card: `${QUIZ_ASSET_BASE}/mainstream-quiz-card.svg`,
    editor: `${QUIZ_ASSET_BASE}/mainstream-quiz-editor.svg`,
    play: `${QUIZ_ASSET_BASE}/mainstream-quiz-play.svg`
  }
};

export const defOption = {
  id: 1,
  label: '',
  options: []
};

export const optionImage = {
  circle: `${QUIZ_ASSET_BASE}/circle.svg`,
  spade: `${QUIZ_ASSET_BASE}/spade.svg`,
  square: `${QUIZ_ASSET_BASE}/square.svg`,
  pentagon: `${QUIZ_ASSET_BASE}/pentagon.svg`,
  hexagon: `${QUIZ_ASSET_BASE}/hexagon.svg`,
  triangle: `${QUIZ_ASSET_BASE}/triangle.svg`
};

export const allOptions = [
  {
    id: 'circle',
    label: '',
    isCorrect: false
  },
  {
    id: 'triangle',
    label: '',
    isCorrect: false
  },
  {
    id: 'spade',
    label: '',
    isCorrect: false
  },
  {
    id: 'square',
    label: '',
    isCorrect: false
  },
  {
    id: 'pentagon',
    label: '',
    isCorrect: false
  },
  {
    id: 'hexagon',
    label: '',
    isCorrect: false
  }
];
export const booleanOptions = [
  {
    id: 'triangle',
    label: 'True',
    isCorrect: false,
    image: `${QUIZ_ASSET_BASE}/triangle.svg`
  },
  {
    id: 'square',
    label: 'False',
    isCorrect: false,
    image: `${QUIZ_ASSET_BASE}/square.svg`
  }
];
export const allThemes = [
  {
    id: 'standard',
    label: 'Standard'
  },
  {
    id: 'mainland',
    label: 'Mainland Bridge'
  }
];

export const defQuestion = {
  id: new Date().getTime(),
  title: '',
  type: 'multichoice',
  options: [],
  timelimit: '10s'
};

export const STEPS = {
  CONNECT_TO_PLAY: 'CONNECT_TO_PLAY',
  WAIT_FOR_PLAYERS: 'WAIT_FOR_PLAYERS',
  SHOW_NEXT_QUESTION: 'SHOW_NEXT_QUESTION',
  SCOREBOARD: 'SCOREBOARD',
  PODIUM: 'PODIUM'
};
