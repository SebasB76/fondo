export type Kind = 'reto' | 'votacion' | 'nunca' | 'todos' | 'duelo' | 'regla' | 'ruleta' | 'elige';
export type Level = 1 | 2 | 3;

export interface CardDef {
  id: string;
  kind: Kind;
  level: Level;
  // {p} = target player, {q} = a second player, {n} = drinks at stake.
  text: string;
  n: number;
  // 'elige' cards where the chooser drinks along with the chosen one.
  alsoMe?: boolean;
}

type Row = [Level, string, number?];

const RETO: Row[] = [
  [1, '{p}, imita a alguien del grupo. Si no adivinan quién es en 30 segundos, tomas {n}.'],
  [1, '{p}, habla con acento argentino hasta tu próximo reto. Si se te olvida, tomas {n}.'],
  [1, '{p}, 10 sentadillas sin soltar el vaso. Si derramas, tomas {n}.'],
  [1, '{p}, di 5 marcas de cerveza en 10 segundos. Si te trabas, tomas {n}.'],
  [1, '{p}, cuenta tu peor papelón en una chupa. O tomas {n}.'],
  [1, '{p}, hablas en tercera persona hasta tu próximo reto. Cada vez que falles, {n}.'],
  [1, '{p}, baila 20 segundos sin música. El grupo decide si cumpliste.'],
  [1, '{p}, imita a un profe de la U hasta que alguien adivine quién es.'],
  [1, '{p}, di algo bonito de cada persona aquí. Sin repetir. O tomas {n}.'],
  [1, '{p}, 15 segundos de stand-up. Si nadie se ríe, tomas {n}.'],
  [1, '{p}, recita el abecedario al revés. Si te equivocas, tomas {n}.'],
  [1, '{p}, haz reír a {q} en 30 segundos sin tocarle. Si no lo logras, tomas {n}.'],
  [1, '{p}, dale un masaje de hombros de 30 segundos a {q}.'],
  [1, '{p}, mira fijamente a {q} 20 segundos sin reírte. Si te ríes, tomas {n}.'],
  [1, '{p}, canta el coro de la última canción que escuchaste. O tomas {n}.'],
  [1, '{p}, narra lo que hace {q} como si fuera un partido de fútbol. 30 segundos.'],
  [1, '{p}, adivina el signo zodiacal de {q}. Si fallas, tomas {n}.'],
  [2, '{p}, manda un audio cantando al último chat de WhatsApp que tengas. O tomas {n}.'],
  [2, '{p}, el grupo escribe tu estado de WhatsApp por una hora. O tomas {n}.'],
  [2, '{p}, enseña la última foto de tu galería. Sin trampa. O tomas {n}.'],
  [2, '{p}, llama a alguien de tus contactos y cántale el Happy Birthday. O tomas {n}.'],
  [2, '{p}, enseña tu historial de búsqueda de YouTube. O tomas {n}.'],
  [2, '{p}, sube una historia que diga "estoy en mi prime" y déjala una hora. O tomas {n}.'],
  [2, '{p}, intercambia una prenda con {q} hasta la próxima ronda. O tomas {n}.'],
  [2, '{p}, lee en voz alta el último mensaje que mandaste. O tomas {n}.'],
  [2, '{p}, cuenta un secreto que nadie aquí sepa. O tomas {n}.'],
  [2, '{p}, deja que {q} te peine como quiera. O tomas {n}.'],
  [2, '{p}, deja que {q} escriba un tweet desde tu cuenta. O tomas {n}.'],
  [3, '{p}, dale tu celular desbloqueado al grupo por un minuto. O tomas {n}.', 3],
  [3, '{p}, manda "te extraño" al penúltimo chat de WhatsApp. O tomas {n}.', 3],
  [3, '{p}, el grupo te elige foto de perfil por 24 horas. O tomas {n}.', 3],
  [3, '{p}, llama a tu ex y solo dile "salud". O tomas {n}.', 3],
  [3, '{p}, deja que {q} mande un mensaje desde tu WhatsApp a quien quiera. O tomas {n}.', 3],
];

const VOTACION: Row[] = [
  [1, 'se quede dormido antes de la 1'],
  [1, 'se haga millonario'],
  [1, 'termine en la cárcel'],
  [1, 'llore esta noche'],
  [1, 'se pierda camino a casa'],
  [1, 'diga "es la última" y no sea la última'],
  [1, 'se case primero'],
  [1, 'pierda el celular esta noche'],
  [1, 'repita el semestre'],
  [1, 'mande audios de 5 minutos'],
  [1, 'sea el último en irse de la chupa'],
  [1, 'se crea DJ y no suelte el parlante'],
  [1, 'pague la próxima ronda'],
  [1, 'se haga viral por algo vergonzoso'],
  [1, 'se duerma en clases mañana'],
  [1, 'sobreviva a un apocalipsis zombie'],
  [2, 'le escriba a su ex esta noche'],
  [2, 'vomite primero'],
  [2, 'termine bailando encima de una mesa'],
  [2, 'tenga una cuenta secreta en redes'],
  [2, 'le caiga al primero que se le cruce'],
  [2, 'termine con un tatuaje del que se arrepienta'],
  [2, 'le haya mentido a alguien de aquí hoy'],
  [2, 'stalkee a su ex esta semana'],
  [3, 'despierte mañana sin saber dónde está', 3],
  [3, 'haya tenido un crush con alguien de aquí', 3],
  [3, 'tenga la peor historia de amor del grupo', 3],
];

const NUNCA: Row[] = [
  [1, 'Yo nunca he mandado un mensaje al chat equivocado.'],
  [1, 'Yo nunca me he quedado dormido en clases.'],
  [1, 'Yo nunca he fingido estar enfermo para no ir a algo.'],
  [1, 'Yo nunca he llorado con una película de Pixar.'],
  [1, 'Yo nunca he dicho "ya voy saliendo" sin haberme bañado.'],
  [1, 'Yo nunca me he colado a una fiesta.'],
  [1, 'Yo nunca he copiado en un examen.'],
  [1, 'Yo nunca he mentido sobre mi edad.'],
  [1, 'Yo nunca he dejado en visto a alguien de este grupo.'],
  [1, 'Yo nunca he repetido ropa dos días seguidos.'],
  [1, 'Yo nunca he borrado un mensaje antes de que lo lean.'],
  [1, 'Yo nunca he perdido algo importante en una chupa.'],
  [1, 'Yo nunca he cantado reguetón a todo pulmón en un taxi.'],
  [1, 'Yo nunca me he caído en público.'],
  [2, 'Yo nunca he stalkeado a un ex.'],
  [2, 'Yo nunca he vomitado en una chupa.'],
  [2, 'Yo nunca he tenido un crush con un profe.'],
  [2, 'Yo nunca he tenido dos crushes al mismo tiempo.'],
  [2, 'Yo nunca he escrito "te extraño" estando borracho.'],
  [2, 'Yo nunca le he hecho ghosting a alguien.'],
  [2, 'Yo nunca he hablado mal de alguien que está aquí.'],
  [3, 'Yo nunca he besado a alguien de este grupo.', 2],
  [3, 'Yo nunca he despertado sin recordar cómo llegué a casa.', 2],
  [3, 'Yo nunca le he caído al pana de un pana.', 2],
];

const TODOS: Row[] = [
  [1, 'tengan menos de 20% de batería'],
  [1, 'hayan llegado tarde hoy'],
  [1, 'estén solteros'],
  [1, 'tengan algo negro puesto'],
  [1, 'hayan dormido menos de 6 horas anoche'],
  [1, 'le deban plata a alguien de aquí'],
  [1, 'hayan jalado una materia'],
  [1, 'hayan dicho "una y nos vamos" hoy'],
  [1, 'tengan zapatos blancos'],
  [1, 'tengan la misma edad que {p}'],
  [1, 'quieran a {p}. Salud por {p}'],
  [2, 'hayan hablado con su ex este mes'],
  [2, 'tengan una app de citas instalada'],
  [2, 'hayan mentido hoy para estar aquí'],
];

const REGLA: Row[] = [
  [1, 'Prohibido decir "tomar". Se dice "hidratarse". El que falle toma {n}.'],
  [1, 'Nadie señala con el dedo. Solo con el codo. El que falle toma {n}.'],
  [1, 'Antes de tomar hay que gritar "¡Salud, mi gente!". El que se olvide toma {n}.'],
  [1, 'Prohibido decir nombres. Solo apodos. El que falle toma {n}.'],
  [1, 'Prohibido decir "bro", "pana" o "mijo". El que falle toma {n}.'],
  [1, 'Cada vez que alguien diga "chuta", todos toman {n}.'],
  [1, 'Nadie puede decir "sí" ni "no". El que falle toma {n}.'],
  [1, '{p} es el rey del silencio: el que le hable toma {n}.'],
  [1, '{p} es el mesero oficial: sirve todos los tragos.'],
  [1, 'Se brinda con la mano izquierda. El que use la derecha toma {n}.'],
  [2, 'Todos hablan en inglés. El que suelte una palabra en español toma {n}.'],
  [2, '{p} y {q} son siameses: cuando uno toma, el otro también.'],
];

const RULETA: Row[] = [
  [1, 'La ruleta decide quién toma {n}.', 2],
  [1, 'Que decida el destino: le toca tomar {n} a...', 2],
  [3, 'Ruleta sin piedad: fondo blanco para...', 4],
];

const ELIGE: Row[] = [
  [1, '{p}, elige a alguien para que tome {n}.', 2],
  [1, '{p}, elige a tu compañero de copas. Los dos toman {n}.', 2],
  [2, '{p}, elige a quien te cae peor esta noche. Toma {n}.', 2],
  [3, '{p}, elige a alguien para un fondo blanco.', 4],
];

const DUELO: Row[] = [
  [1, '{p} contra {q}. Duelo de reflejos: el más lento toma {n}.'],
  [1, 'El más lento del oeste: {p} contra {q}. El que pierda toma {n}.'],
  [1, '{p} y {q}, reflejos de borracho. Quien llegue último toma {n}.'],
];

const DEFAULT_N: Record<Kind, number> = {
  reto: 2, votacion: 2, nunca: 1, todos: 1, duelo: 2, regla: 1, ruleta: 2, elige: 2,
};

function build(kind: Kind, rows: Row[], alsoMe?: (i: number) => boolean): CardDef[] {
  return rows.map(([level, text, n], i) => ({
    id: `${kind}-${i}`,
    kind,
    level,
    text,
    n: n ?? DEFAULT_N[kind],
    ...(alsoMe?.(i) ? { alsoMe: true } : {}),
  }));
}

export const CARDS: CardDef[] = [
  ...build('reto', RETO),
  ...build('votacion', VOTACION),
  ...build('nunca', NUNCA),
  ...build('todos', TODOS),
  ...build('regla', REGLA),
  ...build('ruleta', RULETA),
  ...build('elige', ELIGE, (i) => i === 1),
  ...build('duelo', DUELO),
];

export const KIND_WEIGHTS: Record<Kind, number> = {
  reto: 26, votacion: 20, nunca: 16, todos: 8, duelo: 11, regla: 6, ruleta: 6, elige: 7,
};
