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
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { BadgeCell } from '@/components/data-table/core/badge-cell'
import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { SettingsSection } from '../../components/settings-section'
import { useCampaignAction, useCampaigns } from './api'
import { CampaignFormDialog } from './campaign-form-dialog'
import type { Campaign } from './types'

type PendingAction = { kind: 'publish' | 'end' | 'delete'; campaign: Campaign }

/** What users currently see of a campaign. */
function campaignState(
  campaign: Campaign,
  now: number
): { label: string; variant: StatusVariant } {
  if (campaign.status === 'draft') return { label: 'Draft', variant: 'neutral' }
  if (campaign.status === 'ended') return { label: 'Ended', variant: 'neutral' }
  if (campaign.end_time > 0 && now >= campaign.end_time) {
    return { label: 'Expired', variant: 'warning' }
  }
  if (campaign.start_time > now) return { label: 'Scheduled', variant: 'info' }
  return { label: 'Live', variant: 'success' }
}

function campaignPeriod(campaign: Campaign): string {
  const start = campaign.start_time || campaign.published_at
  const end =
    campaign.status === 'ended' ? campaign.ended_at : campaign.end_time
  return `${formatTimestampToDate(start)} ~ ${formatTimestampToDate(end)}`
}

const confirmCopy = {
  publish: {
    title: 'Publish campaign',
    desc: 'Publish "{{title}}"? It replaces the campaign users see now, which is ended.',
    confirm: 'Publish',
  },
  end: {
    title: 'End campaign',
    desc: 'End "{{title}}"? Users stop seeing it. Orders created before now still earn its bonus when they are paid.',
    confirm: 'End',
  },
  delete: {
    title: 'Delete campaign',
    desc: 'Delete "{{title}}"? Its bonus records are kept.',
    confirm: 'Delete',
  },
} as const

export function CampaignsSection() {
  const { t } = useTranslation()
  const { data: campaigns = [], isLoading } = useCampaigns()
  const action = useCampaignAction()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const now = Math.floor(Date.now() / 1000)

  const openEditor = (id: number | null) => {
    setEditingId(id)
    setDialogOpen(true)
  }

  const confirmPending = async () => {
    if (!pending) return
    const done = await action.mutateAsync({
      kind: pending.kind,
      id: pending.campaign.id,
    })
    if (done) setPending(null)
  }

  const copy = pending ? confirmCopy[pending.kind] : confirmCopy.publish

  return (
    <SettingsSection title={t('Campaigns')}>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Keep every campaign here. Only the published one appears in the header, at /activities and on the wallet.'
          )}
        </p>
        <Button size='sm' onClick={() => openEditor(null)}>
          <Plus className='mr-1.5 h-4 w-4' />
          {t('New campaign')}
        </Button>
      </div>

      <StaticDataTable
        data={campaigns}
        getRowKey={(campaign) => campaign.id}
        emptyClassName='text-sm'
        emptyContent={isLoading ? t('Loading...') : t('No campaigns yet.')}
        columns={[
          {
            id: 'title',
            header: t('Campaign title'),
            cellClassName: 'font-medium',
            cell: (campaign) => campaign.title,
          },
          {
            id: 'status',
            header: t('Status'),
            cell: (campaign) => {
              const state = campaignState(campaign, now)
              return (
                <BadgeCell>
                  <StatusBadge
                    label={t(state.label)}
                    variant={state.variant}
                    copyable={false}
                  />
                </BadgeCell>
              )
            },
          },
          {
            id: 'period',
            header: t('Period'),
            cellClassName: 'text-muted-foreground text-xs whitespace-nowrap',
            cell: (campaign) => campaignPeriod(campaign),
          },
          {
            id: 'tiers',
            header: t('Bonus tiers'),
            cell: (campaign) => campaign.bonus_tiers.length,
          },
          {
            id: 'granted',
            header: t('Bonuses granted'),
            cell: (campaign) =>
              t('{{count}} orders · {{quota}}', {
                count: campaign.bonus_count ?? 0,
                quota: formatQuota(campaign.bonus_quota ?? 0),
              }),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (campaign) => {
              const published = campaign.status === 'published'
              return (
                <div className='flex items-center justify-end gap-1'>
                  <Button
                    size='sm'
                    variant={published ? 'outline' : 'default'}
                    onClick={() =>
                      setPending({
                        kind: published ? 'end' : 'publish',
                        campaign,
                      })
                    }
                  >
                    {published ? t('End') : t('Publish')}
                  </Button>
                  <StaticRowActions
                    editLabel={t('Edit')}
                    deleteLabel={t('Delete')}
                    menuLabel={t('Open menu')}
                    onEdit={() => openEditor(campaign.id)}
                    onDelete={() => setPending({ kind: 'delete', campaign })}
                    deleteDisabled={published}
                  />
                </div>
              )
            },
          },
        ]}
      />

      <CampaignFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        campaignId={editingId}
      />

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={t(copy.title)}
        desc={t(copy.desc, { title: pending?.campaign.title ?? '' })}
        confirmText={t(copy.confirm)}
        destructive={pending?.kind !== 'publish'}
        handleConfirm={confirmPending}
        isLoading={action.isPending}
      />
    </SettingsSection>
  )
}
