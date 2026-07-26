'use strict';

/**
 * @file Tests del formateador de contexto del plan para el Coach IA (puro).
 */

const { formatPlanContext } = require('../../src/services/ai/coachContext');

describe('coachContext.formatPlanContext', () => {
  const base = {
    planName: 'Fuerza y salto',
    currentCycle: 3,
    completedDays: 2,
    day: {
      dayNumber: 1,
      category: 'fuerza',
      title: 'Fuerza tren inferior',
      isRestDay: false,
    },
  };

  it('incluye los ejercicios de hoy con su prescripción (reps y tiempo)', () => {
    const txt = formatPlanContext({
      ...base,
      exercises: [
        {
          name: 'Sentadilla con barra',
          sets: 4,
          reps: '10',
          seconds: null,
          load: { calibrated: true, suggestedValue: 60, unit: 'kg' },
        },
        {
          name: 'Plancha',
          sets: 3,
          reps: null,
          seconds: 30,
          load: null,
        },
      ],
    });

    expect(txt).toContain('Ejercicios de hoy');
    expect(txt).toContain('Sentadilla con barra');
    expect(txt).toContain('4×10 reps');
    expect(txt).toContain('Plancha');
    expect(txt).toContain('3×30s');
    // También el encabezado del día y su categoría.
    expect(txt).toContain('categoría FUERZA');
  });

  it('distingue cargas calibradas (valor real) de no calibradas (SIN REGISTRAR)', () => {
    const txt = formatPlanContext({
      ...base,
      exercises: [
        {
          name: 'Sentadilla con barra',
          sets: 4,
          reps: '10',
          seconds: null,
          load: { calibrated: true, suggestedValue: 60, unit: 'kg' },
        },
        {
          name: 'Peso muerto',
          sets: 3,
          reps: '8',
          seconds: null,
          load: { calibrated: false, suggestedValue: null, unit: 'kg' },
        },
      ],
    });

    // Calibrada → muestra el valor real.
    expect(txt).toContain('carga registrada: 60 kg');
    // No calibrada → NO inventa un número, avisa que falta registrar.
    expect(txt).toContain('SIN REGISTRAR');
    // La línea del peso muerto no debe afirmar una carga en kg.
    const pesoMuertoLine = txt
      .split('\n')
      .find((l) => l.includes('Peso muerto'));
    expect(pesoMuertoLine).not.toMatch(/\d+\s*kg/);
  });

  it('día de descanso → lo indica y no lista ejercicios', () => {
    const txt = formatPlanContext({
      ...base,
      day: {
        dayNumber: 2,
        category: 'descanso',
        title: 'Descanso',
        isRestDay: true,
      },
      exercises: [],
    });

    expect(txt).toContain('DESCANSO');
    expect(txt).not.toContain('Ejercicios de hoy');
  });

  it('sin contexto → null', () => {
    expect(formatPlanContext(null)).toBeNull();
    expect(formatPlanContext({ planName: 'x' })).toBeNull(); // sin day
  });
});
