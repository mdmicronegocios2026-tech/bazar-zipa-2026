let library;

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
  summary.addRow(['Participante', 'Sala', 'Inicio de Bogotá', 'Fin de Bogotá', 'Evaluaciones recibidas', 'Promedio de tres jurados / 5']);
  detail.addRow(['Participante', 'Sala', 'Jurado', ...criteria.map(c => c.nombre), 'Puntuación / 5', 'Observación', 'Fecha de envío', 'Versión']);
  rubric.addRow(['Versión', 'Criterio', 'Peso %', ...[5, 4, 3, 2, 1, 0].map(n => 'Nivel ' + n)]);
  for (const criterion of criteria) rubric.addRow([jornada.rubrica.version, criterion.nombre, criterion.peso, ...[5, 4, 3, 2, 1, 0].map(n => criterion.niveles?.[n] ?? '')]);
  for (const participant of agenda) {
    const received = respuestas.filter(answer => answer.participante_id === participant.id);
    const complete = received.length === 3;
    const score = complete ? received.reduce((sum, answer) => sum + Number(answer.puntuacion), 0) / 3 : null;
    const row = summary.addRow([participant.nombre, participant.sala, formatter.format(new Date(participant.horario)), participant.horario_fin ? formatter.format(new Date(participant.horario_fin)) : null, received.length, score]);
    row.getCell(6).numFmt = '0.00';
    for (const answer of received) {
      const detailRow = detail.addRow([
        participant.nombre, participant.sala, jurados.find(jurado => jurado.opcion === answer.jurado_opcion)?.nombre ?? answer.jurado_id ?? ('Jurado ' + answer.jurado_opcion), ...criteria.map(c => answer.notas[c.id]), Number(answer.puntuacion),
        answer.observacion, formatter.format(new Date(answer.enviada)), answer.rubrica_version
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
