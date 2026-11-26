// Générateur déterministe de statements xAPI 1.0.3 pour le jeu de données de test.
// Même graine + même date de référence = mêmes statements.
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Aléatoire déterministe (mulberry32)
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const chance = (p) => next() < p;
  const uuid = () => {
    const h = Array.from({ length: 16 }, () => int(0, 255));
    h[6] = (h[6] & 0x0f) | 0x40;
    h[8] = (h[8] & 0x3f) | 0x80;
    const s = h.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
  return { next, int, pick, chance, uuid };
}

// ---------------------------------------------------------------------------
// Référentiels
const PRENOMS = ['Léa', 'Hugo', 'Chloé', 'Lucas', 'Emma', 'Louis', 'Manon', 'Nathan', 'Inès', 'Jules',
  'Camille', 'Gabriel', 'Sarah', 'Arthur', 'Zoé', 'Raphaël', 'Lina', 'Tom', 'Jade', 'Noah',
  'Alice', 'Ethan', 'Rose', 'Adam', 'Anna', 'Paul', 'Lou', 'Sacha', 'Mila', 'Maël'];
const NOMS = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy',
  'Moreau', 'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux'];

export const ENT_HOMEPAGE = 'https://ent.profenpoche.test';
const EXT = 'https://profenpoche.test/xapi/extensions/';
const ACT = 'https://profenpoche.test/xapi/activities/';

export const VERBS = {
  experienced: ['http://adlnet.gov/expapi/verbs/experienced', 'experienced', 'a consulté'],
  attempted: ['http://adlnet.gov/expapi/verbs/attempted', 'attempted', 'a tenté'],
  completed: ['http://adlnet.gov/expapi/verbs/completed', 'completed', 'a terminé'],
  passed: ['http://adlnet.gov/expapi/verbs/passed', 'passed', 'a réussi'],
  failed: ['http://adlnet.gov/expapi/verbs/failed', 'failed', 'a échoué'],
  answered: ['http://adlnet.gov/expapi/verbs/answered', 'answered', 'a répondu'],
  interacted: ['http://adlnet.gov/expapi/verbs/interacted', 'interacted', 'a interagi'],
  launched: ['http://adlnet.gov/expapi/verbs/launched', 'launched', 'a lancé'],
  initialized: ['http://adlnet.gov/expapi/verbs/initialized', 'initialized', 'a initialisé'],
  terminated: ['http://adlnet.gov/expapi/verbs/terminated', 'terminated', 'a quitté'],
  progressed: ['http://adlnet.gov/expapi/verbs/progressed', 'progressed', 'a progressé'],
  scored: ['http://adlnet.gov/expapi/verbs/scored', 'scored', 'a obtenu'],
  commented: ['http://adlnet.gov/expapi/verbs/commented', 'commented', 'a commenté'],
  shared: ['http://adlnet.gov/expapi/verbs/shared', 'shared', 'a partagé'],
  votedUp: ['http://curatr3.com/define/verb/voted-up', 'voted up', 'a voté pour'],
  loggedIn: ['https://brindlewaye.com/xAPITerms/verbs/loggedin/', 'logged in', "s'est connecté"],
  open: ['http://activitystrea.ms/schema/1.0/open', 'opened', 'a ouvert'],
  access: ['http://activitystrea.ms/schema/1.0/access', 'accessed', 'a accédé'],
  mentored: ['http://id.tincanapi.com/verb/mentored', 'mentored', 'a accompagné'],
  voided: ['http://adlnet.gov/expapi/verbs/voided', 'voided', 'a annulé'],
  toDelete: ['https://profenpoche.test/xapi/verbs/a-supprimer', 'to delete', 'à supprimer'],
};

const verb = (key) => {
  const [id, en, fr] = VERBS[key];
  return { id, display: { 'en-US': en, 'fr-FR': fr } };
};

const PLATFORMS = ['Profenpoche App', 'Profenpoche App', 'Moodle', 'Stream', 'Curatr'];
const SUBJECTS = ['Mathématiques', 'Français', 'Sciences', 'Histoire-Géographie', 'Anglais'];
const TYPE_COURSE = 'http://adlnet.gov/expapi/activities/course';
const TYPE_LESSON = 'http://adlnet.gov/expapi/activities/lesson';
const TYPE_ASSESSMENT = 'http://adlnet.gov/expapi/activities/assessment';
const TYPE_INTERACTION = 'http://adlnet.gov/expapi/activities/cmi.interaction';
const TYPE_VIDEO = 'https://w3id.org/xapi/video/activity-type/video';
const TYPE_GAME = 'http://activitystrea.ms/schema/1.0/game';
const TYPE_ASSIGNMENT = 'http://id.tincanapi.com/activitytype/school-assignment';
const TYPE_PROFILE = 'http://adlnet.gov/expapi/activities/profile';

// ---------------------------------------------------------------------------
// Construction des acteurs et activités. Le monde est fixe (aucun tirage aléatoire) : le paramètre
// est conservé pour la compatibilité des appels existants.
export function buildWorld(_rng) {
  const learners = [];
  for (let i = 1; i <= 60; i += 1) {
    const prenom = PRENOMS[(i * 7) % PRENOMS.length];
    const nom = NOMS[(i * 11) % NOMS.length];
    const name = `${prenom} ${nom}`;
    const slug = `${prenom}.${nom}${i}`.normalize('NFD').replace(/[^\w.]/g, '').toLowerCase();
    let actor;
    if (i <= 40) {
      actor = { objectType: 'Agent', name, mbox: `mailto:${slug}@eleves.profenpoche.test` };
    } else if (i <= 52) {
      actor = { objectType: 'Agent', name, account: { homePage: ENT_HOMEPAGE, name: `eleve-${String(i).padStart(3, '0')}` } };
    } else if (i <= 56) {
      actor = { objectType: 'Agent', name, openid: `https://openid.profenpoche.test/${slug}` };
    } else {
      const sha = createHash('sha1').update(`mailto:${slug}@prive.profenpoche.test`).digest('hex');
      actor = { name, mbox_sha1sum: sha };
    }
    learners.push({ index: i, name, slug, actor, classe: `${3 + (i % 4)}e${'ABC'[i % 3]}` });
  }

  const teachers = ['Mme Morel', 'M. Fontaine', 'Mme Girard', 'M. Chevalier'].map((name, k) => ({
    name,
    actor: { objectType: 'Agent', name, mbox: `mailto:enseignant${k + 1}@profenpoche.test` },
  }));

  const courses = SUBJECTS.map((subject, k) => ({
    objectType: 'Activity',
    id: `${ACT}cours/${k + 1}`,
    definition: {
      type: TYPE_COURSE,
      name: { 'fr-FR': `Cours de ${subject}`, 'en-US': `${subject} course` },
      description: { 'fr-FR': `Parcours de ${subject} niveau collège` },
      moreInfo: `https://profenpoche.test/cours/${k + 1}`,
      extensions: {
        [`${EXT}niveau`]: `cycle ${3 + (k % 2)}`,
        [`${EXT}matiere`]: { code: `MAT${k + 1}`, libelle: subject },
      },
    },
  }));

  const activities = [];
  courses.forEach((course, k) => {
    for (let j = 1; j <= 5; j += 1) {
      const kind = j === 5 ? 'assessment' : (j === 4 ? 'video' : 'lesson');
      activities.push({
        course,
        kind,
        object: {
          objectType: 'Activity',
          id: `${course.id}/${kind}/${j}`,
          definition: {
            type: kind === 'assessment' ? TYPE_ASSESSMENT : (kind === 'video' ? TYPE_VIDEO : TYPE_LESSON),
            name: { 'fr-FR': `${SUBJECTS[k]} : ${kind === 'assessment' ? 'évaluation' : kind} ${j}`, 'en-US': `${SUBJECTS[k]} ${kind} ${j}` },
            ...(j % 2 === 0 ? { extensions: { [`${EXT}duree.estimee`]: 10 * j } } : {}),
          },
        },
      });
    }
  });

  const interactions = [
    { interactionType: 'choice', choices: ['a', 'b', 'c', 'd'], correct: 'b' },
    { interactionType: 'true-false', correct: 'true' },
    { interactionType: 'numeric', correct: '42' },
    { interactionType: 'likert', scale: ['pas-du-tout', 'un-peu', 'beaucoup'], correct: 'beaucoup' },
    { interactionType: 'sequencing', choices: ['un', 'deux', 'trois'], correct: 'un[,]deux[,]trois' },
    { interactionType: 'matching', source: ['paris', 'rome'], target: ['france', 'italie'], correct: 'paris[.]france[,]rome[.]italie' },
    { interactionType: 'fill-in', correct: 'photosynthèse' },
  ].map((it, k) => {
    const definition = {
      type: TYPE_INTERACTION,
      name: { 'fr-FR': `Question ${k + 1} (${it.interactionType})` },
      interactionType: it.interactionType,
      correctResponsesPattern: [it.correct],
    };
    const comp = (ids) => ids.map((id) => ({ id, description: { 'fr-FR': id } }));
    if (it.choices) definition[it.interactionType === 'sequencing' ? 'choices' : 'choices'] = comp(it.choices);
    if (it.scale) definition.scale = comp(it.scale);
    if (it.source) { definition.source = comp(it.source); definition.target = comp(it.target); }
    return { spec: it, object: { objectType: 'Activity', id: `${ACT}questions/${k + 1}`, definition } };
  });

  const game = {
    objectType: 'Activity',
    id: `${ACT}jeux/tangram`,
    definition: { type: TYPE_GAME, name: { 'fr-FR': 'Tangram', 'en-US': 'Tangram' } },
  };

  const programme = {
    objectType: 'Activity',
    id: `${ACT}programme/college-2026`,
    definition: { type: TYPE_ASSIGNMENT, name: { 'fr-FR': 'Programme collège 2026' } },
  };
  const categorie = {
    objectType: 'Activity',
    id: 'https://w3id.org/xapi/cmi5/v1.0',
    definition: { type: TYPE_PROFILE },
  };

  return { learners, teachers, courses, activities, interactions, game, programme, categorie };
}

// ---------------------------------------------------------------------------
// Dates
const PARIS_OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' });
function parisOffset(date) {
  const part = PARIS_OFFSET.formatToParts(date).find((p) => p.type === 'timeZoneName').value; // GMT+01:00
  return part === 'GMT' ? '+00:00' : part.replace('GMT', '');
}
function formatTimestamp(date, rng) {
  if (rng.chance(0.3)) return date.toISOString();
  const offset = parisOffset(date);
  const sign = offset[0] === '-' ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  const local = new Date(date.getTime() + sign * (h * 60 + m) * 60000);
  return local.toISOString().replace('Z', offset);
}
function randomDate(rng, now) {
  // Distribution biaisée vers les dates récentes : la moitié sur les 60 derniers jours.
  const daysAgo = Math.floor(730 * rng.next() ** 3);
  const d = new Date(now.getTime() - daysAgo * 86400000);
  d.setUTCHours(rng.int(6, 17), rng.int(0, 59), rng.int(0, 59), rng.int(0, 999));
  return d > now ? new Date(now.getTime() - rng.int(1, 3600) * 1000) : d;
}

// ---------------------------------------------------------------------------
function baseContext(rng, world, course, platform) {
  const ctx = {
    platform,
    language: 'fr-FR',
    contextActivities: {
      parent: [course],
      grouping: [world.programme],
      category: [world.categorie],
    },
    extensions: {
      [`${EXT}classe.id`]: `classe-${rng.int(1, 6)}`,
      [`${EXT}appareil`]: rng.pick(['tablette', 'ordinateur', 'téléphone']),
    },
  };
  if (rng.chance(0.3)) ctx.instructor = rng.pick(world.teachers).actor;
  if (rng.chance(0.15)) ctx.contextActivities.other = [world.game];
  return ctx;
}

function resultFor(rng, verbKey) {
  const raw = rng.int(0, 20);
  const r = {
    score: { scaled: Math.round((raw / 20) * 100) / 100, raw, min: 0, max: 20 },
    duration: `PT${rng.int(0, 1)}H${rng.int(1, 59)}M${rng.int(0, 59)}S`,
  };
  if (verbKey === 'passed') r.success = true;
  if (verbKey === 'failed') r.success = false;
  if (verbKey === 'completed' || verbKey === 'passed' || verbKey === 'failed') r.completion = true;
  if (rng.chance(0.2)) r.extensions = { [`${EXT}tentatives`]: rng.int(1, 4) };
  return r;
}

function interactionResponse(rng, spec) {
  const correct = rng.chance(0.6);
  switch (spec.interactionType) {
    case 'choice': return { response: correct ? spec.correct : rng.pick(spec.choices), correct };
    case 'true-false': return { response: correct ? 'true' : 'false', correct };
    case 'numeric': return { response: correct ? '42' : String(rng.int(0, 100)), correct };
    case 'likert': return { response: rng.pick(spec.scale), correct };
    case 'sequencing': return { response: correct ? spec.correct : 'deux[,]un[,]trois', correct };
    case 'matching': return { response: correct ? spec.correct : 'paris[.]italie[,]rome[.]france', correct };
    default: return {
      // Réponse longue (> 40 caractères) : chemin « sha1 » du cache du query builder.
      response: correct ? spec.correct : 'je ne sais pas trop, peut-être la respiration des plantes',
      correct,
    };
  }
}

// ---------------------------------------------------------------------------
// Statements « ordinaires »
export function generateStatements({ seed, now, count, world }) {
  const rng = createRng(seed);
  const out = [];
  const learnerVerbs = ['experienced', 'experienced', 'attempted', 'completed', 'passed', 'failed',
    'progressed', 'launched', 'initialized', 'terminated', 'scored', 'interacted'];

  for (let i = 0; i < count; i += 1) {
    const learner = rng.pick(world.learners);
    const date = randomDate(rng, now);
    const platform = rng.pick(PLATFORMS);
    const social = platform === 'Stream' || platform === 'Curatr';
    const st = { actor: learner.actor, timestamp: formatTimestamp(date, rng) };
    if (rng.chance(0.85)) st.id = rng.uuid();
    if (rng.chance(0.1)) st.version = '1.0.3';

    if (social && rng.chance(0.7)) {
      const key = rng.pick(['commented', 'shared', 'votedUp', 'loggedIn', 'open', 'access', 'completed', 'attempted']);
      const a = rng.pick(world.activities);
      st.verb = verb(key);
      st.object = a.object;
      st.context = baseContext(rng, world, a.course, platform);
      if (key === 'commented') st.result = { response: rng.pick(['Super cours !', 'Je n’ai pas compris la partie 2.', 'Merci pour la vidéo', 'Très clair, avec un exemple de plus ce serait parfait.']) };
    } else if (rng.chance(0.25)) {
      const q = rng.pick(world.interactions);
      const course = rng.pick(world.courses);
      const resp = interactionResponse(rng, q.spec);
      st.verb = verb('answered');
      st.object = q.object;
      st.context = baseContext(rng, world, course, platform);
      st.context.registration = createRng(seed + learner.index * 101 + world.courses.indexOf(course)).uuid();
      st.result = { response: resp.response, success: resp.correct, duration: `PT${rng.int(5, 120)}S` };
    } else if (rng.chance(0.08)) {
      st.verb = verb(rng.pick(['launched', 'completed', 'scored']));
      st.object = world.game;
      st.context = baseContext(rng, world, rng.pick(world.courses), platform);
      st.result = { score: { raw: rng.int(10, 500) }, extensions: { [`${EXT}pieces.placees`]: rng.int(1, 7) } };
    } else {
      const a = rng.pick(world.activities);
      const key = a.kind === 'assessment' ? rng.pick(['attempted', 'passed', 'failed', 'completed', 'scored'])
        : rng.pick(learnerVerbs);
      st.verb = verb(key);
      st.object = a.object;
      st.context = baseContext(rng, world, a.course, platform);
      st.context.registration = createRng(seed + learner.index * 101 + world.courses.indexOf(a.course)).uuid();
      if (['completed', 'passed', 'failed', 'scored', 'progressed'].includes(key)) st.result = resultFor(rng, key);
      if (key === 'progressed') st.result.extensions = { 'https://w3id.org/xapi/cmi5/result/extensions/progress': rng.int(1, 99) };
    }
    out.push(st);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cas particuliers de la spécification (formes rares mais à préserver)
export function generateSpecialStatements({ seed, now, world, existingIds }) {
  const rng = createRng(seed + 999);
  const at = () => formatTimestamp(randomDate(rng, now), rng);
  const learner = () => rng.pick(world.learners).actor;
  const course = () => rng.pick(world.courses);
  const special = { voidable: [], voiding: [], refs: [], groups: [], subStatements: [], agentObjects: [], toDelete: [], putById: [] };

  // Statements qui seront annulés, puis leurs statements d'annulation
  for (let i = 0; i < 20; i += 1) {
    const id = rng.uuid();
    special.voidable.push({ id, actor: learner(), verb: verb('completed'), object: course(), timestamp: at() });
    special.voiding.push({ id: rng.uuid(), actor: world.teachers[0].actor, verb: verb('voided'), object: { objectType: 'StatementRef', id }, timestamp: new Date(now.getTime() - 3600000).toISOString() });
  }
  // Références à des statements existants
  for (let i = 0; i < 10; i += 1) {
    special.refs.push({ actor: rng.pick(world.teachers).actor, verb: verb('commented'), object: { objectType: 'StatementRef', id: rng.pick(existingIds) }, result: { response: 'Bon travail, continue !' }, timestamp: at() });
  }
  // Groupes (anonymes et identifiés)
  for (let i = 0; i < 10; i += 1) {
    const members = [learner(), learner(), learner()].filter((m) => m.objectType === 'Agent' || m.mbox_sha1sum);
    const group = i % 2 === 0
      ? { objectType: 'Group', name: `Équipe ${i + 1}`, member: members }
      : { objectType: 'Group', name: `Classe 4e${'ABC'[i % 3]}`, mbox: `mailto:classe${i}@profenpoche.test`, member: members };
    special.groups.push({ actor: group, verb: verb('completed'), object: world.game, context: { team: group, platform: 'Profenpoche App' }, timestamp: at() });
  }
  // Sous-statements
  for (let i = 0; i < 5; i += 1) {
    special.subStatements.push({
      actor: rng.pick(world.teachers).actor,
      verb: { id: 'http://adlnet.gov/expapi/verbs/asked', display: { 'fr-FR': 'a demandé' } },
      object: { objectType: 'SubStatement', actor: learner(), verb: verb('completed'), object: course(), context: { contextActivities: { parent: [world.programme] } } },
      timestamp: at(),
    });
  }
  // Agent en objet (objectType obligatoire ici, contrairement à l'acteur)
  for (let i = 0; i < 10; i += 1) {
    special.agentObjects.push({ actor: rng.pick(world.teachers).actor, verb: verb('mentored'), object: { ...learner(), objectType: 'Agent' }, timestamp: at() });
  }
  // Statements destinés à la suppression par lots
  for (let i = 0; i < 30; i += 1) {
    special.toDelete.push({ actor: learner(), verb: verb('toDelete'), object: course(), timestamp: at() });
  }
  // Statements envoyés en PUT (id fixé par le client)
  for (let i = 0; i < 5; i += 1) {
    special.putById.push({ id: rng.uuid(), actor: learner(), verb: verb('experienced'), object: course(), timestamp: at() });
  }
  return special;
}

// ---------------------------------------------------------------------------
// Statement avec pièces jointes (multipart/mixed)
export function buildAttachmentRequest({ world, now, index }) {
  const rng = createRng(4242 + index);
  const text = Buffer.from(`Compte rendu de l'élève ${index}\nNote : ${rng.int(0, 20)}/20\n`, 'utf8');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const files = index % 2 === 0 ? [['text/plain', text]] : [['text/plain', text], ['image/png', png]];
  const attachments = files.map(([contentType, buf], k) => ({
    usageType: 'http://id.tincanapi.com/attachment/supporting_media',
    display: { 'fr-FR': `Pièce jointe ${k + 1}` },
    contentType,
    length: buf.length,
    sha2: createHash('sha256').update(buf).digest('hex'),
  }));
  // Pièce jointe référencée par URL seulement (pas de contenu transmis)
  if (index === 0) {
    attachments.push({ usageType: 'http://id.tincanapi.com/attachment/certificate_of_completion', display: { 'fr-FR': 'Certificat' }, contentType: 'application/pdf', length: 1234, sha2: createHash('sha256').update('certificat').digest('hex'), fileUrl: 'https://profenpoche.test/certificats/1.pdf' });
  }
  const statement = {
    id: rng.uuid(),
    actor: rng.pick(world.learners).actor,
    verb: verb('completed'),
    object: rng.pick(world.courses),
    timestamp: new Date(now.getTime() - index * 86400000).toISOString(),
    attachments,
  };
  const boundary = `seedboundary${index}`;
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(statement)}\r\n`),
  ];
  files.forEach(([contentType, buf], k) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: binary\r\nX-Experience-API-Hash: ${attachments[k].sha2}\r\n\r\n`));
    parts.push(buf);
    parts.push(Buffer.from('\r\n'));
  });
  parts.push(Buffer.from(`--${boundary}--`));
  return { statement, body: Buffer.concat(parts), contentType: `multipart/mixed; boundary=${boundary}` };
}
