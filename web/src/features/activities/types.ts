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
export type TopUpBonusType = 'fixed' | 'percent'

/**
 * One tier of the top-up bonus. Amounts are in top-up units (USD), the same
 * unit as the wallet's recharge amount.
 */
export interface TopUpBonusTier {
  min_amount: number
  type: TopUpBonusType
  /** Fixed: bonus amount. Percent: bonus percentage of the top-up. */
  value: number
  /** Percent tiers only: the largest bonus, 0 for no cap. */
  max_bonus?: number
}

/** The published campaign, as GET /api/campaign/current serves it. */
export interface CurrentCampaign {
  /** Published and not yet past its end time. */
  visible: boolean
  /** Orders created now earn the bonus. */
  active: boolean
  id?: number
  title?: string
  /** The campaign page HTML. */
  content?: string
  start_time?: number
  end_time?: number
  tiers?: TopUpBonusTier[]
}

export type CurrentCampaignResponse = {
  success: boolean
  message?: string
  data: CurrentCampaign
}
