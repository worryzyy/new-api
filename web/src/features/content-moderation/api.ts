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
import { t } from 'i18next'

import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

export type ModerationAction = 'block' | 'observe' | 'unban'

export interface ModerationLog {
  id: number
  created_at: number
  request_id: string
  user_id: number
  username: string
  token_id: number
  token_name: string
  group_name: string
  model_name: string
  endpoint: string
  action: ModerationAction
  source: string
  matched_keyword: string
  category: string
  score: number
  category_scores: string
  input_excerpt: string
  violation_count: number
  auto_banned: boolean
}

export interface ModerationLogFilters {
  p: number
  page_size: number
  start_timestamp?: number
  end_timestamp?: number
  username?: string
  action?: string
  source?: string
}

export interface ModerationVerdict {
  flagged: boolean
  source?: string
  matched_keyword?: string
  category?: string
  score?: number
  category_scores?: Record<string, number>
}

export async function getModerationLogs(
  params: ModerationLogFilters
): Promise<{ items: ModerationLog[]; total: number }> {
  const response = await api.get<
    ApiResponse<{ items: ModerationLog[]; total: number }>
  >('/api/content_moderation/logs', { params })
  if (!response.data.success || !response.data.data) {
    throw createServerError(
      response.data,
      t('Failed to load content moderation records')
    )
  }
  return response.data.data
}

export async function getModerationStatus(): Promise<{
  openai_api_key_configured: boolean
}> {
  const response = await api.get<
    ApiResponse<{ openai_api_key_configured: boolean }>
  >('/api/content_moderation/status')
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data)
  }
  return response.data.data
}

export async function testModeration(text: string): Promise<ModerationVerdict> {
  const response = await api.post<ApiResponse<ModerationVerdict>>(
    '/api/content_moderation/test',
    { text }
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, t('Moderation test failed'))
  }
  return response.data.data
}

export async function unbanModerationUser(userId: number): Promise<void> {
  const response = await api.post<ApiResponse<null>>(
    `/api/content_moderation/users/${userId}/unban`
  )
  if (!response.data.success) {
    throw createServerError(response.data, t('Failed to unban user'))
  }
}
