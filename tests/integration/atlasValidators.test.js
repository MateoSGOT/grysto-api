'use strict';

/**
 * @file Los validadores de `db/validators/` (los mismos que se aplican a mano
 * en Atlas) están activos en la DB de tests y coinciden con los schemas.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');

describe('Validadores $jsonSchema de Atlas', () => {
  it('rechazan un documento inválido (campo extra / tipo incorrecto)', async () => {
    const users = mongoose.connection.db.collection('users');
    await expect(
      users.insertOne({ nombre: 'X', email: 'x@y.z', password: 'p', campoExtra: 1 })
    ).rejects.toMatchObject({ code: 121 }); // DocumentValidationFailure

    const codes = mongoose.connection.db.collection('authCodes');
    await expect(
      codes.insertOne({ userId: 'no-es-objectid', purpose: 'otro' })
    ).rejects.toMatchObject({ code: 121 });
  });

  it('refreshtokens solo acepta hashes SHA-256, nunca el token en plano', async () => {
    const tokens = mongoose.connection.db.collection('refreshtokens');
    const doc = (token) => ({
      userId: new mongoose.Types.ObjectId(),
      token,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      replacedByToken: null,
      createdByIp: null,
      revokedAt: null,
      createdAt: new Date(),
    });
    await expect(tokens.insertOne(doc('a'.repeat(64)))).resolves.toBeTruthy();
    // Un token opaco en plano (80 hex) no tiene forma de hash.
    await expect(tokens.insertOne(doc('b'.repeat(80)))).rejects.toMatchObject({ code: 121 });
  });

  it('campos con default no aceptan null (users.role, userPlans.status)', async () => {
    const { db } = mongoose.connection;
    const now = new Date();
    const user = {
      nombre: 'Test',
      email: 'null@test.com',
      password: 'x'.repeat(60),
      role: 'user',
      plan: 'free',
      planExpiresAt: null,
      isEmailVerified: true,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await expect(db.collection('users').insertOne(user)).resolves.toBeTruthy();
    await expect(
      db.collection('users').insertOne({ ...user, email: 'otro@test.com', role: null })
    ).rejects.toMatchObject({ code: 121 });

    const plan = {
      userId: new mongoose.Types.ObjectId(),
      weeklyPlanId: null,
      isAIGenerated: false,
      aiGeneratedContent: null,
      source: 'user_selected',
      status: 'active',
      startedAt: now,
      endsAt: null,
      progress: [],
      completionPercentage: 0,
      currentCycle: 1,
      cycles: [],
      substitutions: [],
      createdAt: now,
      updatedAt: now,
    };
    await expect(db.collection('userPlans').insertOne(plan)).resolves.toBeTruthy();
    await expect(
      db.collection('userPlans').insertOne({ ...plan, status: null })
    ).rejects.toMatchObject({ code: 121 });
  });

  it('los archivos de db/validators coinciden con los schemas de Mongoose', () => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'generate-validators.js');
    // --check sale con código 1 (y execFileSync lanza) si hay diferencias.
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })
    ).not.toThrow();
  });
});
