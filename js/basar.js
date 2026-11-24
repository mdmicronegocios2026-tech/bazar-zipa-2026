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
  form.reset();
  evaluation.hidden = true;
}

async function refresh() {
  const activeProfile = profile;
  const [jornada, agenda, respuestas] = (await Promise.all([
    client.from('basar_jornada').select('abierta,rubrica').single(),
    client.from('basar_participantes').select('id,nombre,sala,horario,horario_fin').order('sala').order('horario').order('id'),
    client.from('basar_evaluaciones').select('*')
  ])).map(read);
  if (profile !== activeProfile) return;
  model = { jornada, agenda, respuestas };
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

  const rows = agenda.map(participant => {
    const received = respuestas.filter(answer => answer.participante_id === participant.id);
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
      const edit = node('button', 'Editar', 'secondary');
      action(edit, () => editParticipant(row, participant));
      actions.append(node('span', received.length + ' de 3 evaluaciones'), edit);
      row.append(actions);
    } else if (received.length) {
      row.append(node('span', 'Evaluación enviada'));
    } else {
      const evaluate = node('button', jornada.abierta ? 'Evaluar' : 'Pendiente');
      evaluate.disabled = !jornada.abierta;
      action(evaluate, () => openEvaluation(participant, jornada.rubrica));
      row.append(evaluate);
    }
    return { sala: participant.sala, row };
  });
  const rooms = (admin ? [1, 2] : [profile.sala]).map(sala => {
    const section = document.createElement('section');
    const heading = node('h3', 'Sala ' + sala);
    const roomRows = rows.filter(item => item.sala === sala).map(item => item.row);
    section.append(heading, ...(roomRows.length ? roomRows : [node('p', 'No hay turnos cargados para esta sala.')]));
    return section;
  });
  byId('agenda').replaceChildren(...rooms);
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
  access.hidden = !user;
  if (!user) return;
  profile = read(await client.from('basar_perfiles').select('nombre,rol,puesto,sala').eq('id', user.id).maybeSingle());
  if (!profile) {
    read(await client.auth.signOut());
    access.hidden = false;
    throw new Error('Esta cuenta aún no tiene acceso a Bazar Zipa 2026.');
  }
  await refresh();
  dashboard.hidden = false;
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
action(form, async () => {
  const participant = selected;
  if (!participant) return;
  const data = new FormData(form);
  const notas = Object.fromEntries(model.jornada.rubrica.criterios.map(criterion => [
    criterion.id, Number(data.get('nota_' + criterion.id).replace(',', '.'))
  ]));
  const observacion = data.get('observacion').trim();
  if (!observacion) throw new Error('Escribe la observación final.');
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
  const { exportResults } = await import('./basar-report.js');
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
  client = globalThis.supabase.createClient(backend.url, backend.key, { auth: { storageKey: 'basar-sipa-2026-auth' } });
  const { session } = read(await client.auth.getSession());
  await showSession(session?.user);
}

start().catch(error => {
  status.textContent = error.message || 'No se pudo conectar con Supabase.';
  access.hidden = !client;
});
