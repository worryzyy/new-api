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
import { Link } from '@tanstack/react-router'
import { Gift } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { RichContent } from '@/components/rich-content'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatTimestampToDate } from '@/lib/format'

import { useCurrentCampaign } from './api'
import { sortTopUpBonusTiers, tierReward } from './lib/bonus'
import type { CurrentCampaign } from './types'

/**
 * The published campaign. Its own HTML page is shown when it has one,
 * otherwise a page built from its title, period and bonus tiers.
 */
export function CampaignPage() {
  const { t } = useTranslation()
  const query = useCurrentCampaign()
  const html = query.data?.visible ? query.data.content?.trim() : ''

  if (html) {
    return (
      <PublicLayout showMainContainer={false}>
        <RichContent
          mode='html'
          htmlVariant='isolated'
          content={html}
          className='prose-neutral dark:prose-invert max-w-none'
        />
      </PublicLayout>
    )
  }

  let content: ReactNode
  if (query.isLoading) {
    content = (
      <div className='space-y-4'>
        <Skeleton className='h-10 w-2/3' />
        <Skeleton className='h-5 w-1/2' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  } else if (query.data?.visible) {
    content = <CampaignDetails campaign={query.data} />
  } else {
    content = (
      <EmptyState
        icon={Gift}
        title={t('No campaign right now')}
        description={t('Check back later for new campaigns.')}
      />
    )
  }

  return (
    <PublicLayout>
      <PageTransition className='mx-auto w-full max-w-4xl space-y-6 px-3 pt-10 pb-12 sm:px-6 sm:pt-16'>
        {content}
      </PageTransition>
    </PublicLayout>
  )
}

function CampaignDetails(props: { campaign: CurrentCampaign }) {
  const { t } = useTranslation()
  const campaign = props.campaign
  const tiers = sortTopUpBonusTiers(campaign.tiers)

  return (
    <>
      <header className='space-y-3 text-center'>
        <StatusBadge
          variant={campaign.active ? 'success' : 'info'}
          copyable={false}
        >
          {campaign.active ? t('In progress') : t('Starting soon')}
        </StatusBadge>
        <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
          {campaign.title || t('Top-up Bonus')}
        </h1>
        <p className='text-muted-foreground text-sm'>
          {campaignPeriod(campaign, t)}
        </p>
      </header>

      {tiers.length > 0 ? (
        <>
          <section
            aria-label={t('Bonus tiers')}
            className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
          >
            {tiers.map((tier) => (
              <Card key={tier.min_amount} data-card-hover='false'>
                <CardContent className='space-y-1 p-5 text-center'>
                  <div className='text-muted-foreground text-sm'>
                    {t('Single top-up of {{amount}} or more', {
                      amount: formatCurrencyFromUSD(tier.min_amount),
                    })}
                  </div>
                  <div className='text-chart-3 text-2xl font-bold'>
                    {tierReward(tier, t)}
                  </div>
                  {tier.type === 'percent' && tier.max_bonus ? (
                    <div className='text-muted-foreground text-xs'>
                      {t('Up to {{amount}}', {
                        amount: formatCurrencyFromUSD(tier.max_bonus),
                      })}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </section>

          <div className='text-muted-foreground space-y-1 text-center text-xs'>
            <p>
              {t(
                'Each top-up earns the highest tier it reaches. The bonus is added to your balance as soon as the payment succeeds.'
              )}
            </p>
          </div>
        </>
      ) : null}

      <div className='flex justify-center'>
        <Button render={<Link to='/wallet' />} size='lg'>
          {t('Top up now')}
        </Button>
      </div>
    </>
  )
}

function campaignPeriod(
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
