import { jsPDF } from 'jspdf';
import type { CalculationDetails } from './friisCalculations';

interface PdfParams {
  mode: 'distance' | 'power';
  txPowerWatts: number;
  txGainDbi: number;
  rxGainDbi: number;
  frequencyMhz: number;
  sensitivityDbm?: number;
  distanceKm?: number;
  resultValue: string;
  resultUnit: string;
  details: CalculationDetails;
  labels: {
    title: string;
    date: string;
    txAntenna: string;
    rxAntenna: string;
    power: string;
    gain: string;
    frequency: string;
    sensitivity: string;
    distance: string;
    result: string;
    calculationDetails: string;
    txPower: string;
    totalGain: string;
    maxFSPL: string;
    fspl: string;
    note: string;
  };
  isRtl: boolean;
  realisticData?: {
    regionName: string;
    weatherDescription: string;
    realisticValue: string;
    freeSpaceValue: string;
    reductionPercent: string;
    resultUnit: string;
    totalExtraLoss: number;
    lossRows: { label: string; value: number }[];
    labels: {
      realisticSection: string;
      region: string;
      weather: string;
      realisticRange: string;
      freeSpaceRange: string;
      reduction: string;
      lossBreakdown: string;
      totalExtra: string;
    };
  };
}

export function generatePDF(params: PdfParams) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 25;

  // Title
  doc.setFontSize(18);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text(params.labels.title, pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Date
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128); // gray-500
  doc.text(`${params.labels.date}: ${new Date().toLocaleDateString()}`, pageWidth / 2, y, { align: 'center' });
  y += 12;

  // Separator
  doc.setDrawColor(229, 231, 235); // gray-200
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // TX Antenna section
  doc.setFontSize(13);
  doc.setTextColor(31, 41, 55); // gray-800
  doc.text(params.labels.txAntenna, margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99); // gray-600
  doc.text(`${params.labels.power}: ${params.txPowerWatts} W`, margin + 5, y);
  y += 6;
  doc.text(`${params.labels.gain}: ${params.txGainDbi} dBi`, margin + 5, y);
  y += 10;

  // RX Antenna section
  doc.setFontSize(13);
  doc.setTextColor(31, 41, 55);
  doc.text(params.labels.rxAntenna, margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text(`${params.labels.gain}: ${params.rxGainDbi} dBi`, margin + 5, y);
  y += 10;

  // Frequency
  doc.text(`${params.labels.frequency}: ${params.frequencyMhz} MHz`, margin + 5, y);
  y += 6;

  // Sensitivity / Distance
  if (params.mode === 'distance' && params.sensitivityDbm !== undefined) {
    doc.text(`${params.labels.sensitivity}: ${params.sensitivityDbm} dBm`, margin + 5, y);
    y += 6;
  }
  if (params.mode === 'power' && params.distanceKm !== undefined) {
    doc.text(`${params.labels.distance}: ${params.distanceKm} km`, margin + 5, y);
    y += 6;
  }

  y += 4;
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Result
  doc.setFontSize(14);
  doc.setTextColor(79, 70, 229);
  doc.text(`${params.labels.result}: ${params.resultValue} ${params.resultUnit}`, pageWidth / 2, y, { align: 'center' });
  y += 12;

  // Calculation details
  doc.setFontSize(12);
  doc.setTextColor(31, 41, 55);
  doc.text(params.labels.calculationDetails, margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text(`${params.labels.txPower}: ${params.details.txPowerDbm.toFixed(2)} dBm`, margin + 5, y);
  y += 6;
  doc.text(`${params.labels.totalGain}: ${params.details.totalGain.toFixed(2)} dBi`, margin + 5, y);
  y += 6;

  if (params.mode === 'distance' && params.details.maxFSPL !== undefined) {
    doc.text(`${params.labels.maxFSPL}: ${params.details.maxFSPL.toFixed(2)} dB`, margin + 5, y);
    y += 6;
  }
  if (params.mode === 'power' && params.details.fspl !== undefined) {
    doc.text(`${params.labels.fspl}: ${params.details.fspl.toFixed(2)} dB`, margin + 5, y);
    y += 6;
  }

  y += 10;

  // Realistic data section (if present)
  if (params.realisticData) {
    const rd = params.realisticData;
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Section header
    doc.setFontSize(13);
    doc.setTextColor(16, 185, 129); // emerald-500
    doc.text(rd.labels.realisticSection, margin, y);
    y += 8;

    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.text(`${rd.labels.region}: ${rd.regionName}`, margin + 5, y);
    y += 6;
    doc.text(`${rd.labels.weather}: ${rd.weatherDescription}`, margin + 5, y);
    y += 8;

    // Comparison
    doc.setFontSize(11);
    doc.setTextColor(31, 41, 55);
    doc.text(`${rd.labels.realisticRange}: ${rd.realisticValue} ${rd.resultUnit}`, margin + 5, y);
    y += 6;
    doc.text(`${rd.labels.freeSpaceRange}: ${rd.freeSpaceValue} ${rd.resultUnit}`, margin + 5, y);
    y += 6;
    doc.setTextColor(239, 68, 68); // red-500
    doc.text(`${rd.labels.reduction}: ${rd.reductionPercent}`, margin + 5, y);
    y += 8;

    // Loss breakdown
    if (rd.lossRows.length > 0) {
      doc.setFontSize(10);
      doc.setTextColor(31, 41, 55);
      doc.text(rd.labels.lossBreakdown, margin + 5, y);
      y += 6;
      doc.setTextColor(75, 85, 99);
      for (const row of rd.lossRows) {
        doc.text(`  ${row.label}: +${row.value.toFixed(1)} dB`, margin + 10, y);
        y += 5;
      }
      y += 2;
    }

    // Total extra loss
    doc.setFontSize(10);
    doc.setTextColor(239, 68, 68);
    doc.text(`${rd.labels.totalExtra}: +${rd.totalExtraLoss.toFixed(1)} dB`, margin + 5, y);
    y += 10;
  }

  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Disclaimer
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175); // gray-400
  doc.text(params.labels.note, pageWidth / 2, y, { align: 'center' });

  doc.save('antenna-calculation.pdf');
}
