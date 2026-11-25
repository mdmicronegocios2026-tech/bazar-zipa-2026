import { backend } from './basar-config.js';

const byId = id => document.getElementById(id);
const status = byId('status');
const access = byId('access');
const dashboard = byId('dashboard');
const evaluation = byId('evaluation');
const form = byId('evaluation-form');
const toggle = byId('toggle');
const formatter = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short'
});
const timeFormatter = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', timeStyle: 'short'
});
let client;
let profile;
let model;
let selected;
let pending;
let expectedRole;
let view = 'progress';
let roomFilter = 0;
const privateLink = /^#sala-(1|2)=([0-9a-f]{64})$/.exec(location.hash);

function read(result) {
  if (result.error) throw result.error;
  return result.data;
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = content;
  if (className) element.className = className;
  return element;
}

function action(target, handler) {
  const event = target instanceof HTMLFormElement ? 'submit' : 'click';
  target.addEventListener(event, async e => {
    e.preventDefault();
    const button = event === 'submit' ? e.submitter : target;
    if (button?.disabled) return;
    if (button) button.disabled = true;
    status.textContent = '';
    try {
      await handler();
    } catch (error) {
      status.textContent = error.message || 'La operación no se pudo completar.';
    } finally {
      if (button) button.disabled = button === toggle && !model?.jornada.rubrica;
    }
  });
}

function resetEvaluation() {
  selected = null;
  pending = null;
  form.hidden = false;
  byId('review').hidden = true;
  form.reset();
  evaluation.hidden = true;
  if (profile?.rol === 'jurado') byId('agenda').hidden = false;
}

async function refresh() {
  const activeProfile = profile;
  const [jornada, agenda, respuestas, jurados] = (await Promise.all([
    client.from('basar_jornada').select('abierta,rubrica').single(),
    client.from('basar_participantes').select('id,nombre,sala,horario,horario_fin').order('sala').order('horario').order('id'),
    client.from('basar_evaluaciones').select('*'),
    activeProfile.rol === 'admin'
      ? client.from('basar_perfiles').select('id,nombre,sala,puesto').eq('rol', 'jurado').order('sala').order('puesto')
      : { data: [] }
  ])).map(read);
  if (profile !== activeProfile) return;
  model = { jornada, agenda, respuestas, jurados };
  render();
}

function render() {
  const admin = profile.rol === 'admin';
  const { jornada, agenda, respuestas } = model;
  byId('profile').textContent = admin ? profile.nombre + ' · Administración' : profile.nombre + ' · Sala ' + profile.sala + ' · Jurado ' + profile.puesto;
  byId('admin').hidden = !admin;
  toggle.disabled = !jornada.rubrica;
  toggle.textContent = jornada.abierta ? 'Cerrar evaluaciones' : 'Abrir evaluaciones';
  byId('availability').textContent = jornada.abierta ? 'Evaluaciones abiertas' :
    jornada.rubrica ? 'Evaluaciones cerradas' : 'Evaluaciones cerradas · Rúbrica oficial pendiente';

  const target = byId('agenda');
  target.hidden = admin ? view === 'config' : Boolean(selected);
  byId('admin-controls').hidden = !admin || !['config', 'agenda', 'results'].includes(view);
  byId('config-controls').hidden = view !== 'config';
  byId('agenda-controls').hidden = view !== 'agenda';
  byId('result-controls').hidden = view !== 'results';
  for (const tab of byId('admin').querySelectorAll('[data-view]')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
  }
  if (target.hidden) return;

  const rooms = admin ? (roomFilter ? [roomFilter] : [1, 2]) : [profile.sala];
  const sections = rooms.map(sala => {
    const section = document.createElement('section');
    const participants = agenda.filter(item => item.sala === sala);
    const jurors = model.jurados.filter(item => item.sala === sala);
    section.append(node('h3', 'Sala ' + sala));
    if (admin && ['assignments', 'jurors'].includes(view)) {
      if (view === 'assignments') {
        section.append(node('p', 'Los ' + participants.length + ' emprendimientos de esta sala se asignan a sus tres puestos de jurado.'));
      }
      for (const position of [1, 2, 3]) {
        const juror = jurors.find(item => item.puesto === position);
        section.append(node('p', 'Jurado ' + position + ' · ' + (juror?.nombre ?? 'Jurado provisional ' + ((sala - 1) * 3 + position))));
      }
      return section;
    }
    if (admin && view === 'progress') {
      const totals = [0, 0, 0, 0];
      for (const participant of participants) {
        totals[respuestas.filter(answer => answer.participante_id === participant.id).length]++;
      }
      const metrics = node('div', '', 'bazar-metrics');
      totals.forEach((count, score) => metrics.append(node('p', count + (count === 1 ? ' participante' : ' participantes') + ' con ' + score + ' de 3')));
      section.append(metrics);
    }
    if (participants.length === 0) section.append(node('p', 'No hay turnos cargados para esta sala.'));
    for (const participant of participants) {
      const received = respuestas.filter(answer => answer.participante_id === participant.id);
      if (admin && view === 'results' && !received.length) continue;
      const row = node('div', '', 'agenda-row');
      const info = node('div', '');
      const time = node('time', formatter.format(new Date(participant.horario)), 'hint');
      time.dateTime = participant.horario;
      info.append(node('strong', participant.nombre), document.createElement('br'), time);
      if (participant.horario_fin) {
        const end = node('time', ' – ' + timeFormatter.format(new Date(participant.horario_fin)), 'hint');
        end.dateTime = participant.horario_fin;
        info.append(end);
      }
      row.append(info);
      if (admin) {
        const actions = node('div', '', 'actions');
        actions.append(node('span', received.length + ' de 3 evaluaciones'));
        if (['agenda', 'participants'].includes(view)) {
          const edit = node('button', 'Editar', 'btn btn-secondary btn-small');
          action(edit, () => editParticipant(row, participant));
          actions.append(edit);
        }
        if (view === 'results') {
          const details = document.createElement('details');
          details.append(node('summary', 'Ver respuestas'));
          for (const answer of received) {
            const juror = jurors.find(item => item.id === answer.jurado_id);
            details.append(node('p', (juror?.nombre ?? 'Jurado') + ' · ' + answer.puntuacion + ' / 5'));
            details.append(node('p', answer.observacion));
          }
          info.append(details);
        }
        row.append(actions);
      } else if (received.length) {
        row.append(node('span', 'Evaluación enviada'));
      } else {
        const evaluate = node('button', jornada.abierta ? 'Evaluar' : 'Pendiente', 'btn btn-primary btn-small');
        evaluate.disabled = !jornada.abierta;
        action(evaluate, () => openEvaluation(participant, jornada.rubrica));
        row.append(evaluate);
      }
      section.append(row);
    }
    if (admin && view === 'results' && section.children.length === 1) {
      section.append(node('p', 'Todavía no hay evaluaciones para esta sala.'));
    }
    return section;
  });

  if (admin) {
    const label = node('label', 'Sala');
    label.htmlFor = 'room-filter';
    const select = document.createElement('select');
    select.id = 'room-filter';
    select.append(new Option('Todas las salas', 0), new Option('Sala 1', 1), new Option('Sala 2', 2));
    select.value = roomFilter;
    select.addEventListener('change', () => {
      roomFilter = Number(select.value);
      render();
      byId('room-filter').focus();
    });
    const tools = node('div', '', 'bazar-room-tools');
    tools.append(label, select);
    target.replaceChildren(tools, ...sections);
  } else {
    target.replaceChildren(...sections);
  }
}

function openEvaluation(participant, rubric) {
  resetEvaluation();
  selected = participant;
  const fields = rubric.criterios.map(criterion => {
    const label = node('label', criterion.nombre + ' · ' + criterion.peso + ' %');
    const input = document.createElement('input');
    input.name = 'nota_' + criterion.id;
    input.inputMode = 'decimal';
    input.pattern = '[0-5]([.,][0-9]{1,2})?';
    input.placeholder = '0 a 5';
    input.required = true;
    label.append(input);
    if (!criterion.niveles) return label;
    const group = document.createElement('div');
    const guide = document.createElement('details');
    const levels = document.createElement('dl');
    for (const score of [5, 4, 3, 2, 1, 0]) {
      levels.append(node('dt', 'Nivel ' + score), node('dd', criterion.niveles[score]));
    }
    guide.append(node('summary', 'Consultar niveles'), levels);
    group.append(label, guide);
    return group;
  });
  byId('criteria').replaceChildren(...fields);
  byId('evaluation-title').textContent = 'Evaluar a ' + participant.nombre;
  evaluation.hidden = false;
  byId('agenda').hidden = true;
  updateScore();
  byId('evaluation-title').focus();
}

function agendaRow(name, slot, end) {
  const nombre = name?.trim();
  const time = slot?.trim().replace('T', ' ');
  if (!nombre || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time)) {
    throw new Error('Revisa el nombre y el formato de fecha y hora.');
  }
  const localAsUtc = time.replace(' ', 'T') + ':00Z';
  const comparable = new Date(localAsUtc);
  if (!Number.isFinite(+comparable) || comparable.toISOString().slice(0, 16) !== localAsUtc.slice(0, 16)) {
    throw new Error('La fecha o la hora no es válida.');
  }
  const finish = end?.trim();
  const horario = time.replace(' ', 'T') + ':00-05:00';
  const horario_fin = time.slice(0, 10) + 'T' + finish + ':00-05:00';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(finish) || new Date(horario_fin) <= new Date(horario)) {
    throw new Error('La hora de fin debe ser posterior al inicio.');
  }
  return { nombre, horario, horario_fin };
}

function editParticipant(row, participant) {
  const edit = document.createElement('form');
  const name = document.createElement('input');
  name.required = true;
  name.value = participant.nombre;
  const time = document.createElement('input');
  time.type = 'datetime-local';
  time.required = true;
  time.value = new Date(new Date(participant.horario).getTime() - 5 * 3600000).toISOString().slice(0, 16);
  const nameLabel = node('label', 'Participante');
  nameLabel.append(name);
  const timeLabel = node('label', 'Horario de Bogotá');
  timeLabel.append(time);
  const finish = document.createElement('input');
  finish.type = 'time';
  finish.required = true;
  if (participant.horario_fin) {
    finish.value = new Date(new Date(participant.horario_fin).getTime() - 5 * 3600000).toISOString().slice(11, 16);
  }
  const finishLabel = node('label', 'Hora de fin');
  finishLabel.append(finish);
  const save = node('button', 'Guardar cambios');
  const cancel = node('button', 'Cancelar', 'secondary');
  cancel.type = 'button';
  cancel.addEventListener('click', render);
  edit.append(nameLabel, timeLabel, finishLabel, save, cancel);
  row.replaceChildren(edit);
  name.focus();
  action(edit, async () => {
    read(await client.from('basar_participantes').update(agendaRow(name.value, time.value, finish.value)).eq('id', participant.id));
    await refresh();
  });
}

async function showSession(user) {
  profile = null;
  model = null;
  resetEvaluation();
  dashboard.hidden = true;
  access.hidden = true;
  byId('jury-access').hidden = true;
  byId('welcome').hidden = Boolean(user);
  byId('logout').hidden = true;
  byId('profile').textContent = '';
  if (!user) return;
  profile = read(await client.from('basar_perfiles').select('nombre,rol,puesto,sala').eq('id', user.id).maybeSingle());
  if (!profile) {
    read(await client.auth.signOut());
    byId('welcome').hidden = false;
    throw new Error('Esta cuenta aún no tiene acceso a Bazar Zipa 2026.');
  }
  if (expectedRole && profile.rol !== expectedRole) {
    read(await client.auth.signOut());
    await showSession(null);
    throw new Error('Elige el acceso que corresponde al rol de esta cuenta.');
  }
  view = 'progress';
  roomFilter = 0;
  await refresh();
  byId('dashboard-title').textContent = profile.rol === 'admin' ? 'Panel de Administración' : 'Emprendimientos de tu sala';
  byId('logout').hidden = false;
  dashboard.hidden = false;
  byId('dashboard-title').focus();
}

function showLogin(role) {
  expectedRole = role;
  status.textContent = '';
  byId('welcome').hidden = true;
  access.hidden = false;
  byId('access-title').textContent = role === 'admin' ? 'Acceso de administración' : 'Acceso de jurados';
  byId('login').elements.email.focus();
}

byId('open-jury').addEventListener('click', () => {
  byId('welcome').hidden = true;
  byId('jury-access').hidden = false;
  const slot = byId('jury-slot');
  if (privateLink) {
    for (const group of slot.querySelectorAll('optgroup')) {
      const ownRoom = group.dataset.sala === privateLink[1] || group.label === 'Sala ' + privateLink[1];
      group.disabled = !ownRoom;
      group.hidden = !ownRoom;
    }
  }
  slot.focus();
});
byId('jury-back').addEventListener('click', () => {
  byId('jury-picker').reset();
  byId('jury-selection-status').textContent = '';
  byId('jury-private-agenda').replaceChildren();
  byId('jury-private-agenda').hidden = true;
  byId('jury-access').hidden = true;
  byId('welcome').hidden = false;
  byId('open-jury').focus();
});
action(byId('jury-picker'), async () => {
  const slot = byId('jury-slot');
  const position = Number(slot.value);
  const sala = position <= 3 ? 1 : 2;
  const announcement = byId('jury-selection-status');
  const agenda = byId('jury-private-agenda');
  announcement.textContent = '';
  agenda.hidden = true;
  agenda.replaceChildren();
  if (!privateLink) {
    announcement.textContent = slot.selectedOptions[0].textContent + ' · Sala ' + sala +
      '. Abre el enlace privado de tu sala para consultar la agenda.';
    return;
  }
  if (!client) throw new Error('No se pudo conectar con Supabase. Recarga la página.');
  const participants = read(await client.rpc('bazar_agenda_privada', { codigo: privateLink[2], opcion: position }));
  announcement.textContent = slot.selectedOptions[0].textContent + ' · Sala ' + sala;
  const heading = node('h3', 'Agenda de tu sala');
  const rows = participants.map(participant => {
    const row = node('div', '', 'agenda-row');
    const end = participant.horario_fin ? ' – ' + timeFormatter.format(new Date(participant.horario_fin)) : '';
    row.append(node('strong', participant.nombre), node('span', formatter.format(new Date(participant.horario)) + end, 'hint'));
    return row;
  });
  agenda.replaceChildren(heading, ...rows);
  agenda.hidden = false;
});
byId('open-admin').addEventListener('click', () => showLogin('admin'));
byId('back-home').addEventListener('click', () => {
  access.hidden = true;
  status.textContent = '';
  byId('welcome').hidden = false;
  byId(expectedRole === 'admin' ? 'open-admin' : 'open-jury').focus();
});
for (const tab of byId('admin').querySelectorAll('[data-view]')) {
  tab.addEventListener('click', () => {
    view = tab.dataset.view;
    render();
  });
}

action(byId('login'), async () => {
  const login = byId('login');
  const data = new FormData(login);
  const { user } = read(await client.auth.signInWithPassword({
    email: data.get('email').trim(), password: data.get('password')
  }));
  login.reset();
  await showSession(user);
});

action(byId('logout'), async () => {
  read(await client.auth.signOut());
  await showSession(null);
});

action(toggle, async () => {
  read(await client.from('basar_jornada').update({ abierta: !model.jornada.abierta }).eq('id', true).select('id').single());
  await refresh();
});

action(byId('agenda-form'), async () => {
  const agendaForm = byId('agenda-form');
  const fields = new FormData(agendaForm);
  const value = fields.get('rows');
  const sala = Number(fields.get('sala'));
  const rows = value.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      const fields = line.split('\t');
      if (fields.length !== 3) throw new Error('Se necesitan tres columnas.');
      return { ...agendaRow(...fields), sala };
    } catch (error) {
      throw new Error('Fila ' + (index + 1) + ' · ' + error.message);
    }
  });
  if (!rows.length) throw new Error('Agrega al menos un participante.');
  read(await client.from('basar_participantes').upsert(rows, {
    onConflict: 'sala,nombre,horario', ignoreDuplicates: true
  }));
  agendaForm.reset();
  await refresh();
});

byId('cancel').addEventListener('click', resetEvaluation);
function updateScore() {
  const data = new FormData(form);
  const total = model.jornada.rubrica.criterios.reduce((sum, criterion) => {
    const value = Number(data.get('nota_' + criterion.id).replace(',', '.'));
    return sum + (value >= 0 && value <= 5 ? value * criterion.peso / 100 : 0);
  }, 0);
  byId('score').textContent = total.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
form.addEventListener('input', updateScore);

action(form, () => {
  if (!selected) return;
  const data = new FormData(form);
  const criteria = model.jornada.rubrica.criterios;
  const notas = Object.fromEntries(criteria.map(criterion => [
    criterion.id, Number(data.get('nota_' + criterion.id).replace(',', '.'))
  ]));
  if (Object.values(notas).some(value => !Number.isFinite(value) || value < 0 || value > 5)) {
    throw new Error('Cada calificación debe estar entre 0 y 5.');
  }
  const observacion = data.get('observacion').trim();
  if (!observacion) throw new Error('Escribe la observación final.');
  pending = { notas, observacion };
  const rows = criteria.flatMap(criterion => [
    node('dt', criterion.nombre), node('dd', String(notas[criterion.id]))
  ]);
  rows.push(node('dt', 'Puntuación ponderada'), node('dd', byId('score').textContent), node('dt', 'Observación final'), node('dd', observacion));
  byId('review-summary').replaceChildren(...rows);
  form.hidden = true;
  byId('review').hidden = false;
  byId('send').focus();
});

byId('back-edit').addEventListener('click', () => {
  byId('review').hidden = true;
  form.hidden = false;
  byId('review-button').focus();
});
action(byId('send'), async () => {
  const participant = selected;
  if (!participant || !pending) return;
  const { notas, observacion } = pending;
  try {
    read(await client.from('basar_evaluaciones').insert({ participante_id: participant.id, notas, observacion }));
  } catch (error) {
    await refresh();
    if (!model.respuestas.some(answer => answer.participante_id === participant.id)) throw error;
  }
  resetEvaluation();
  await refresh();
  status.textContent = 'Evaluación registrada.';
});

action(byId('export'), async () => {
  await refresh();
  const { exportResults } = await import('./basar-report.js?v=2');
  await exportResults(model, formatter);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dashboard.hidden === false) {
    refresh().catch(error => { status.textContent = error.message; });
  }
});

async function start() {
  if (!backend.url || !backend.key) throw new Error('Falta configurar la conexión con Supabase.');
  if (!globalThis.supabase) throw new Error('No se pudo cargar el cliente de Supabase.');
  client = globalThis.supabase.createClient(backend.url, backend.key, { auth: { storageKey: 'basar-sipa-2026-auth', detectSessionInUrl: !privateLink } });
  if (privateLink) {
    const slot = byId('jury-slot');
    const note = byId('jury-access-note');
    slot.disabled = true;
    note.textContent = 'Cargando los jurados de tu sala…';
    byId('open-jury').click();
    try {
      const jurors = read(await client.rpc('bazar_jurados_agenda', {
        codigo: privateLink[2], sala_solicitada: Number(privateLink[1])
      }));
      if (jurors.length !== 3) throw new Error('La lista de esta sala aún está incompleta.');
      const group = document.createElement('optgroup');
      group.dataset.sala = privateLink[1];
      group.label = 'Salón ' + jurors[0].salon;
      group.append(...jurors.map(juror => new Option(juror.nombre, juror.opcion)));
      slot.replaceChildren(new Option('Selecciona tu nombre', ''), group);
      note.textContent = group.label + ' · Selecciona tu nombre para consultar la agenda.';
      slot.disabled = false;
      if (!byId('jury-access').hidden) slot.focus();
    } catch (error) {
      note.textContent = error.message;
    }
    return;
  }
  const { session } = read(await client.auth.getSession());
  await showSession(session?.user);
}

start().catch(error => {
  status.textContent = error.message || 'No se pudo conectar con Supabase.';
  byId('welcome').hidden = false;
});
