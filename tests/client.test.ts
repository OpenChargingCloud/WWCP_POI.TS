import { describe, expect, it } from 'vitest';

import { AT, readText } from './helpers.ts';
import { anchorPQ } from './qa.ts';

import { POIClient, type Fetch } from '../src/client.ts';
import { TrustAnchor }           from '../src/proofs/trustAnchor.ts';


// An app selects the EVSE DE*GEF*E1*1 and downloads its station proof and price statements from the servers the trust
// anchor names: the first is down, the second answers with a station of another power, the third as it should.

describe('POIClient', () => {

    const scanned  = anchorPQ;
    const anchor   = TrustAnchor.create('QA',
                                        [ 'https://down.example/RNs/QA', 'https://forged.example/RNs/QA', 'https://open.charging.cloud/RNs/QA' ],
                                        scanned.keys, scanned.minConsensus, scanned.name, scanned.description);

    const requested: string[] = [];

    const fetch: Fetch = async url => {

        requested.push(url);

        if (url.startsWith('https://down.example/'))
            throw new Error('connection refused');

        const proof       = readText('proofs/QA-proof-station-DE_GEF_S1.json');
        const statements  = readText('published/QA-epoch-2-checkpoint-0-priceStatements.json');

        const body = url.endsWith('/proof')
                         ? url.startsWith('https://forged.example/') ? proof.replace('"maxPower": 300000', '"maxPower": 400000') : proof
                         : statements;

        return { ok: true, status: 200, text: async () => body };

    };

    it('checks the station and its prices, from the first server whose answer verifies', async () => {

        const client  = new POIClient(anchor, { fetch });
        const checked = await client.chargingStation({ evseId: 'DE*GEF*E1*1' }, { at: AT });

        expect(checked.source).toBe('https://open.charging.cloud/RNs/QA');
        expect(checked.station.chargingStation['@id']).toBe('DE*GEF*S1');
        expect(checked.prices.get('EVSE:DE*GEF*E1*1')!.statement.sequence).toBe(3);
        expect(requested).toContain('https://open.charging.cloud/RNs/QA/EVSEs/DE*GEF*E1*1/proof');
        expect(requested).toContain('https://open.charging.cloud/RNs/QA/EVSEs/DE*GEF*E1*1/priceStatements');

    });

    it('refuses when no server gives what verifies', async () => {

        const forgedOnly = TrustAnchor.create('QA', [ 'https://forged.example/RNs/QA' ], scanned.keys, scanned.minConsensus);
        await expect(new POIClient(forgedOnly, { fetch }).chargingStation({ evseId: 'DE*GEF*E1*1' }, { at: AT })).rejects.toThrow(/gave a proof and price statements that verify/);

    });

});
