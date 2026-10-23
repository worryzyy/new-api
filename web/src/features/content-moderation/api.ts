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

export type ModerationMode = 'off' | 'observe' | 'pre_block'
export type KeywordBlockingMode =
  | 'keyword_and_api'
  | 'keyword_only'
  | 'api_only'
export type ModelFilterType = 'all' | 'include' | 'exclude'

export interface ModerationConfig {
  enabled: boolean
  mode: ModerationMode
  base_url: string
  model: string
  api_keys: string[]
  timeout_ms: number
  retry_count: number
  sample_rate: number
  check_images: boolean
  all_groups: boolean
  groups: string[]
  model_filter: { type: ModelFilterType; models: string[] }
  exempt_user_ids: number[]
  thresholds: Record<string, number>
  worker_count: number
  queue_size: number
  record_non_hits: boolean
  pre_hash_check_enabled: boolean
  block_status: number
  block_message: string
  auto_ban_enabled: boolean
  ban_threshold: number
  violation_window_hours: number
  blocked_keywords: string[]
  keyword_blocking_mode: KeywordBlockingMode
  hit_retention_days: number
  non_hit_retention_days: number
}

export interface ModerationKeyStatus {
  index: number
  key_hash: string
  masked: string
  status: 'ok' | 'error' | 'frozen' | 'unknown'
  configured: boolean
  failure_count: number
  success_count: number
  last_error: string
  last_checked_at: number
  frozen_until: number
  last_latency_ms: number
  last_http_status: number
  last_tested: boolean
}

export interface ModerationKeyLoad {
  index: number
  key_hash: string
  masked: string
  status: ModerationKeyStatus['status']
  active: number
  total: number
  success: number
  errors: number
  avg_latency_ms: number
  last_latency_ms: number
  last_http_status: number
}

export interface ModerationConfigView extends ModerationConfig {
  api_key_configured: boolean
  api_key_count: number
  api_key_masks: string[]
  api_key_statuses: ModerationKeyStatus[]
}

export interface ModerationConfigUpdate extends ModerationConfig {
  api_keys_mode: 'append' | 'replace'
  delete_api_key_hashes: string[]
  clear_api_keys: boolean
}

export interface ModerationStatus {
  engine: string
  enabled: boolean
  mode: ModerationMode
  redis_enabled: boolean
  pre_block_active: number
  pre_block_checked: number
  pre_block_allowed: number
  pre_block_blocked: number
  pre_block_errors: number
  pre_block_avg_latency_ms: number
  worker_count: number
  max_workers: number
  active_workers: number
  idle_workers: number
  queue_size: number
  queue_length: number
  queue_usage_percent: number
  enqueued: number
  dropped: number
  processed: number
  async_errors: number
  api_key_count: number
  api_key_available_count: number
  api_key_active: number
  api_key_total_calls: number
  api_key_loads: ModerationKeyLoad[]
  api_key_statuses: ModerationKeyStatus[]
  flagged_hash_count: number
  last_cleanup_at: number
  last_cleanup_deleted_hit: number
  last_cleanup_deleted_non_hit: number
}

export type ModerationAction =
  | 'allow'
  | 'block'
  | 'keyword_block'
  | 'hash_block'
  | 'error'

export interface ModerationLog {
  id: number
  created_at: number
  request_id: string
  user_id: number
  username: string
  user_email: string
  token_id: number
  token_name: string
  group_name: string
  model_name: string
  endpoint: string
  mode: string
  action: ModerationAction
  flagged: boolean
  source: string
  matched_keyword: string
  category: string
  score: number
  category_scores: string
  threshold_snapshot: string
  input_excerpt: string
  input_hash: string
  error: string
  upstream_latency_ms: number
  queue_delay_ms: number
  violation_count: number
  auto_banned: boolean
  user_status: number
}

export interface ModerationLogFilters {
  p: number
  page_size: number
  result?: string
  group?: string
  endpoint?: string
  search?: string
  start_timestamp?: number
  end_timestamp?: number
}

export interface ModerationVerdict {
  flagged: boolean
  source?: string
  matched_keyword?: string
  highest_category?: string
  highest_score: number
  category_scores?: Record<string, number>
  thresholds?: Record<string, number>
}

export interface ModerationKeyTestRequest {
  api_keys?: string[]
  base_url?: string
  model?: string
  timeout_ms?: number
  thresholds?: Record<string, number>
  prompt?: string
  images?: string[]
}

export interface ModerationKeyTestResult {
  items: ModerationKeyStatus[]
  audit_result?: ModerationVerdict
  image_count: number
}

async function unwrap<T>(
  request: Promise<{ data: ApiResponse<T> }>,
  fallback?: string
): Promise<T> {
  const response = await request
  if (!response.data.success || response.data.data === undefined) {
    throw createServerError(response.data, fallback)
  }
  return response.data.data
}

export function getModerationStatus(): Promise<ModerationStatus> {
  return unwrap(api.get('/api/content_moderation/status'))
}

export function getModerationConfig(): Promise<ModerationConfigView> {
  return unwrap(
    api.get('/api/content_moderation/config'),
    t('Failed to load settings')
  )
}

export function updateModerationConfig(
  update: ModerationConfigUpdate
): Promise<ModerationConfigView> {
  return unwrap(
    api.put('/api/content_moderation/config', update),
    t('Failed to update setting')
  )
}

export function testModerationKeys(
  request: ModerationKeyTestRequest
): Promise<ModerationKeyTestResult> {
  return unwrap(
    api.post('/api/content_moderation/api-keys/test', request),
    t('Moderation test failed')
  )
}

export function getModerationLogs(
  params: ModerationLogFilters
): Promise<{ items: ModerationLog[]; total: number }> {
  return unwrap(
    api.get('/api/content_moderation/logs', { params }),
    t('Failed to load content moderation records')
  )
}

export async function unbanModerationUser(userId: number): Promise<void> {
  const response = await api.post<ApiResponse<null>>(
    `/api/content_moderation/users/${userId}/unban`
  )
  if (!response.data.success) {
    throw createServerError(response.data, t('Failed to unban user'))
  }
}

export function deleteModerationHash(
  inputHash: string
): Promise<{ input_hash: string; deleted: boolean }> {
  return unwrap(
    api.delete('/api/content_moderation/hashes', {
      data: { input_hash: inputHash },
    })
  )
}

export function clearModerationHashes(): Promise<{ deleted: number }> {
  return unwrap(api.delete('/api/content_moderation/hashes/all'))
}

export async function getGroupNames(): Promise<string[]> {
  return unwrap(api.get('/api/group/'))
}

export async function getModelNames(): Promise<string[]> {
  return unwrap(api.get('/api/channel/models_enabled'))
}
