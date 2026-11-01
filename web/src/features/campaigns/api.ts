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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { CURRENT_CAMPAIGN_QUERY_KEY } from '@/features/activities/api'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { Campaign, CampaignInput } from './types'

interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

const CAMPAIGNS_QUERY_KEY = ['campaigns']

export function useCampaigns() {
  return useQuery({
    queryKey: CAMPAIGNS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<ApiResponse<Campaign[]>>('/api/campaign/')
      return requireServerSuccess(res.data).data ?? []
    },
  })
}

/** The full campaign, page HTML included, for the editor. */
export function useCampaign(id: number | null) {
  return useQuery({
    queryKey: [...CAMPAIGNS_QUERY_KEY, id],
    enabled: id !== null,
    queryFn: async () => {
      const res = await api.get<ApiResponse<Campaign>>(`/api/campaign/${id}`)
      return requireServerSuccess(res.data).data
    },
  })
}

type CampaignAction =
  | { kind: 'create'; input: CampaignInput }
  | { kind: 'update'; id: number; input: CampaignInput }
  | { kind: 'delete'; id: number }
  | { kind: 'publish'; id: number }
  | { kind: 'end'; id: number }

const successMessages: Record<CampaignAction['kind'], string> = {
  create: 'Campaign created',
  update: 'Campaign saved',
  delete: 'Campaign deleted',
  publish: 'Campaign published',
  end: 'Campaign ended',
}

async function runCampaignAction(action: CampaignAction): Promise<ApiResponse> {
  switch (action.kind) {
    case 'create':
      return (await api.post('/api/campaign/', action.input)).data
    case 'update':
      return (await api.put(`/api/campaign/${action.id}`, action.input)).data
    case 'delete':
      return (await api.delete(`/api/campaign/${action.id}`)).data
    case 'publish':
      return (await api.post(`/api/campaign/${action.id}/publish`)).data
    case 'end':
      return (await api.post(`/api/campaign/${action.id}/end`)).data
  }
}

/** Creates, saves, deletes, publishes or ends a campaign; resolves to whether it succeeded. */
export function useCampaignAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: CampaignAction) => {
      const res = await runCampaignAction(action)
      if (!res.success) {
        handleServerError(res)
        return false
      }
      toast.success(i18next.t(successMessages[action.kind]))
      queryClient.invalidateQueries({ queryKey: CAMPAIGNS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CURRENT_CAMPAIGN_QUERY_KEY })
      return true
    },
    onError: (error: Error) => handleServerError(error),
  })
}
