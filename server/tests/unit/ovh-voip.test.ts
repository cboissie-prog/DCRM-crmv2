/**
 * ovh-voip.test.ts — mapping du relevé d'appels OVH vers le modèle Call.
 */
import { describe, it, expect } from 'vitest'
import { mapConsumptionToCall, isOvhConfigured, type OvhVoiceConsumption } from '../../src/services/ovh-voip'

const BA = 'ovhtel-x-1'
const SERVICE = '0033972000000'

function consumption(overrides: Partial<OvhVoiceConsumption>): OvhVoiceConsumption {
  return {
    consumptionId: 42,
    creationDatetime: '2026-08-10T10:00:00+02:00',
    calling: '0033611223344',
    called: SERVICE,
    duration: 90,
    wayType: 'incoming',
    ...overrides,
  }
}

describe('mapConsumptionToCall', () => {
  it('appel entrant répondu → INBOUND / ANSWERED, tiers = appelant', () => {
    const { call, externalParty } = mapConsumptionToCall(BA, SERVICE, consumption({}))
    expect(call.direction).toBe('INBOUND')
    expect(call.status).toBe('ANSWERED')
    expect(call.callerNumber).toBe('0033611223344')
    expect(call.receiverNumber).toBe(SERVICE)
    expect(call.duration).toBe(90)
    expect(call.externalId).toBe(`ovh:${BA}:${SERVICE}:42`)
    expect(externalParty).toBe('0033611223344')
    // endedAt = startedAt + durée
    expect(call.endedAt!.getTime() - call.startedAt.getTime()).toBe(90 * 1000)
  })

  it('appel entrant non répondu (durée 0) → MISSED sans answeredAt/endedAt', () => {
    const { call } = mapConsumptionToCall(BA, SERVICE, consumption({ duration: 0 }))
    expect(call.status).toBe('MISSED')
    expect(call.answeredAt).toBeUndefined()
    expect(call.endedAt).toBeUndefined()
  })

  it('appel sortant → OUTBOUND, tiers = appelé', () => {
    const { call, externalParty } = mapConsumptionToCall(BA, SERVICE, consumption({
      wayType: 'outgoing',
      calling: SERVICE,
      called: '0033611223344',
    }))
    expect(call.direction).toBe('OUTBOUND')
    expect(call.callerNumber).toBe(SERVICE)
    expect(call.receiverNumber).toBe('0033611223344')
    expect(externalParty).toBe('0033611223344')
  })

  it('transfert → traité comme INBOUND', () => {
    const { call } = mapConsumptionToCall(BA, SERVICE, consumption({ wayType: 'transfer' }))
    expect(call.direction).toBe('INBOUND')
  })

  it('appelant masqué → fallback "Inconnu" (callerNumber est requis par le modèle)', () => {
    const { call } = mapConsumptionToCall(BA, SERVICE, consumption({ calling: '' }))
    expect(call.callerNumber).toBe('Inconnu')
  })

  it('called vide → fallback sur dialed puis sur la ligne', () => {
    const withDialed = mapConsumptionToCall(BA, SERVICE, consumption({ called: '', dialed: '0033972000000' }))
    expect(withDialed.call.receiverNumber).toBe('0033972000000')
    const bare = mapConsumptionToCall(BA, SERVICE, consumption({ called: '' }))
    expect(bare.call.receiverNumber).toBe(SERVICE)
  })
})

describe('isOvhConfigured', () => {
  it('false tant que les trois clés ne sont pas posées', () => {
    const saved = { ...process.env }
    delete process.env.OVH_APP_KEY
    delete process.env.OVH_APP_SECRET
    delete process.env.OVH_CONSUMER_KEY
    expect(isOvhConfigured()).toBe(false)

    process.env.OVH_APP_KEY = 'ak'
    process.env.OVH_APP_SECRET = 'as'
    expect(isOvhConfigured()).toBe(false)

    process.env.OVH_CONSUMER_KEY = 'ck'
    expect(isOvhConfigured()).toBe(true)

    process.env = saved
  })
})
