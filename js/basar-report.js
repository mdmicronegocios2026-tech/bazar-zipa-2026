import { semaforo } from './basar-semaforo.js';
let library;

const consolidatedStyles = {
  verde: ['FFD9F2DF', 'FF16532A'],
  amarillo: ['FFFFEDAC', 'FF634600'],
  rojo: ['FFFADBD9', 'FF81252A'],
  neutral: ['FFECEFF1', 'FF37474F']
};

function loadLibrary() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/exceljs-4.4.0.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.ExcelJS);
    script.onerror = () => reject(new Error('No se pudo cargar la exportación a Excel.'));
    document.head.append(script);
  }).catch(error => {
    library = null;
    throw error;
  });
}

export async function exportResults({ jornada, agenda, respuestas, jurados = [] }, formatter) {
  library ??= loadLibrary();
  const { Workbook } = await library;
  const workbook = new Workbook();
  const criteria = jornada.rubrica?.criterios ?? [];
  const summary = workbook.addWorksheet('Consolidado');
  const detail = workbook.addWorksheet('Detalle por jurado');
  const rubric = workbook.addWorksheet('Rúbrica');
  summary.addRow([
    'Participante', 'Sala', 'Evaluaciones recibidas', 'Evaluaciones pendientes',
    'Jurado 1', 'Nota 1 / 5', 'Jurado 2', 'Nota 2 / 5', 'Jurado 3', 'Nota 3 / 5',
    'Nota final / 5', 'Estado', 'Observaciones por jurado', 'Semáforo por jurado', 'Semáforo consolidado'
  ]);
  detail.addRow(['Participante', 'Sala', 'Jurado', ...criteria.map(c => c.nombre), 'Puntuación / 5', 'Observación', 'Semáforo de participación', 'Fecha de envío', 'Versión']);
  rubric.addRow(['Versión', 'Criterio', 'Peso %', ...[5, 4, 3, 2, 1, 0].map(n => 'Nivel ' + n)]);
  for (const criterion of criteria) rubric.addRow([jornada.rubrica.version, criterion.nombre, criterion.peso, ...[5, 4, 3, 2, 1, 0].map(n => criterion.niveles?.[n] ?? '')]);
  for (const participant of agenda) {
    const received = respuestas.filter(answer => answer.participante_id === participant.id);
    const assigned = jurados.filter(jurado => jurado.sala === participant.sala);
    const slots = [1, 2, 3].map(puesto => {
      const jurado = assigned.find(item => item.puesto === puesto);
      const option = jurado?.opcion ?? (participant.sala - 1) * 3 + puesto;
      const answer = received.find(item => item.jurado_opcion === option || (jurado?.id && item.jurado_id === jurado.id));
      return { name: jurado?.nombre ?? 'Jurado ' + puesto, answer };
    });
    for (const answer of received.filter(item => !slots.some(slot => slot.answer === item))) {
      const available = slots.find(slot => !slot.answer);
      if (available) {
        available.name = 'Jurado anterior';
        available.answer = answer;
      }
    }
    const complete = received.length === 3 && slots.every(slot => slot.answer);
    const score = complete ? slots.reduce((sum, slot) => sum + Number(slot.answer.puntuacion), 0) / 3 : null;
    const colors = slots.map(slot => slot.answer?.semaforo);
    const counts = colors.map(color => colors.filter(value => value === color).length);
    const majority = colors.find((color, index) => ['verde', 'amarillo', 'rojo'].includes(color) && counts[index] >= 2);
    const hasCurrentVotes = colors.every(color => ['verde', 'amarillo', 'rojo'].includes(color));
    const consolidated = !complete ? 'Pendiente' : !hasCurrentVotes ? 'Requiere revisión' :
      majority ? semaforo[majority] : 'Sin consenso';
    const row = summary.addRow([
      participant.nombre, participant.sala, received.length, Math.max(0, 3 - received.length),
      ...slots.flatMap(({ name, answer }) => [name, answer ? Number(answer.puntuacion) : null]),
      score, complete ? 'Completa' : 'Pendiente',
      slots.map(({ name, answer }) => name + ': ' + (answer?.observacion || (answer ? 'Sin observación' : 'Pendiente'))).join('\n'),
      slots.map(({ name, answer }) => name + ': ' + (semaforo[answer?.semaforo] ?? (answer ? 'Sin respuesta' : 'Pendiente'))).join('\n'),
      consolidated
    ]);
    const [background, foreground] = consolidatedStyles[(complete && hasCurrentVotes && majority) || 'neutral'];
    const signal = row.getCell(15);
    signal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
    signal.font = { bold: true, color: { argb: foreground } };
    signal.alignment = { wrapText: true, vertical: 'middle' };
    for (const column of [6, 8, 10, 11]) row.getCell(column).numFmt = '0.00';
    for (const column of [13, 14]) row.getCell(column).alignment = { wrapText: true, vertical: 'top' };
    const observationLines = row.getCell(13).value.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 68)), 0);
    row.height = Math.min(300, 18 * Math.max(3, observationLines));
    for (const answer of received) {
      const detailRow = detail.addRow([
        participant.nombre, participant.sala, jurados.find(jurado => jurado.opcion === answer.jurado_opcion)?.nombre ?? answer.jurado_id ?? ('Jurado ' + answer.jurado_opcion), ...criteria.map(c => answer.notas[c.id]), Number(answer.puntuacion),
        answer.observacion, semaforo[answer.semaforo] ?? null, formatter.format(new Date(answer.enviada)), answer.rubrica_version
      ]);
      detailRow.getCell(4 + criteria.length).numFmt = '0.00';
    }
  }
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143D30' } };
    sheet.columns.forEach(column => { column.width = 28; });
  }
  summary.columns.forEach((column, index) => {
    column.width = [36, 10, 16, 16, 28, 13, 28, 13, 28, 13, 16, 16, 74, 52, 38][index];
  });
  summary.getRow(1).height = 34;
  summary.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
  summary.autoFilter = 'A1:O' + summary.rowCount;
  for (const column of rubric.columns.slice(3)) column.width = 48;
  for (let i = 2; i <= rubric.rowCount; i++) {
    rubric.getRow(i).height = 84;
    rubric.getRow(i).alignment = { wrapText: true, vertical: 'top' };
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const download = document.createElement('a');
  download.href = url;
  download.download = 'Resultados-Bazar-Zipa-2026.xlsx';
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
