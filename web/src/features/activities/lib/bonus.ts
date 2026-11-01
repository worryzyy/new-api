/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatTimestampToDate } from '@/lib/format'

import type { CurrentCampaign, TopUpBonusTier } from '../types'

export function sortTopUpBonusTiers(
  tiers: TopUpBonusTier[] | undefined
): TopUpBonusTier[] {
  return [...(tiers ?? [])].sort((a, b) => a.min_amount - b.min_amount)
}

/**
 * The bonus a single top-up of `amount` earns, mirroring the server: the
 * highest tier whose minimum the amount reaches applies. Returns 0 when no
 * tier matches.
 */
export function topUpBonusFor(
  amount: number,
  tiers: TopUpBonusTier[] | undefined
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  let tier: TopUpBonusTier | undefined
  for (const candidate of tiers ?? []) {
    if (amount < candidate.min_amount) continue
    if (!tier || candidate.min_amount > tier.min_amount) tier = candidate
  }
  if (!tier) return 0
  if (tier.type === 'fixed') return tier.value
  const bonus = (amount * tier.value) / 100
  return tier.max_bonus && tier.max_bonus > 0
    ? Math.min(bonus, tier.max_bonus)
    : bonus
}

/** The reward a tier gives, e.g. "Get $5 free" or "Get 8% extra". */
export function tierReward(
  tier: TopUpBonusTier,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return tier.type === 'fixed'
    ? t('Get {{amount}} free', { amount: formatCurrencyFromUSD(tier.value) })
    : t('Get {{percent}}% extra', { percent: tier.value })
}

/** The campaign period as a sentence, e.g. "2026-11-01 to 2026-11-11". */
export function campaignPeriod(
  campaign: CurrentCampaign,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const start = campaign.start_time
    ? formatTimestampToDate(campaign.start_time)
    : ''
  const end = campaign.end_time ? formatTimestampToDate(campaign.end_time) : ''
  if (start && end) return t('{{start}} to {{end}}', { start, end })
  if (end) return t('Ends {{end}}', { end })
  if (start) return t('Starts {{start}}', { start })
  return t('Limited-time offer')
}
