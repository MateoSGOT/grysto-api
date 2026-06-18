'use strict';

/**
 * @file Model Subscription — suscripción premium del usuario y su estado
 * de facturación con la pasarela de pago.
 */

const mongoose = require('mongoose');
const { SUB_STATUS, PLANS, valuesOf } = require('../constants/enums');

const BILLING_CYCLES = ['monthly', 'yearly'];

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: { type: String, enum: valuesOf(SUB_STATUS), required: true },
    plan: { type: String, default: PLANS.PREMIUM },
    priceUSD: { type: Number, default: 5, min: [0, 'El precio no puede ser negativo'] },
    billingCycle: {
      type: String,
      enum: BILLING_CYCLES,
      default: 'monthly',
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    paymentMethod: { type: String, default: null },
    gatewayCustomerId: { type: String, default: null },
    gatewaySubscriptionId: { type: String, default: null },
    lastPaymentDate: { type: Date, default: null },
    nextBillingDate: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

subscriptionSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
