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
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { CurrentCampaignResponse } from './types'

export const CURRENT_CAMPAIGN_QUERY_KEY = ['current-campaign']

export async function getCurrentCampaign(): Promise<CurrentCampaignResponse> {
  const res = await api.get('/api/campaign/current')
  return res.data
}

/** The published campaign, shared by the header link, the page and the wallet. */
export function useCurrentCampaign() {
  return useQuery({
    queryKey: CURRENT_CAMPAIGN_QUERY_KEY,
    queryFn: async () => requireServerSuccess(await getCurrentCampaign()).data,
    staleTime: 60 * 1000,
    meta: { errorToast: false },
  })
}
