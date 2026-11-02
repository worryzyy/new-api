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
import { cn } from '@/lib/utils'

type NavLinkLabelProps = {
  title: string
  highlight?: boolean
  className?: string
}

/**
 * A top navigation label. Highlighted links (such as a live campaign) get a
 * pulsing dot and a light sweeping across the text to draw attention.
 */
export function NavLinkLabel({
  title,
  highlight,
  className,
}: NavLinkLabelProps) {
  if (!highlight) return title

  return (
    <span
      className={cn('relative inline-flex items-center gap-1.5', className)}
    >
      <span className='relative flex size-1.5 shrink-0' aria-hidden='true'>
        <span className='bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:animate-none' />
        <span className='bg-primary relative inline-flex size-1.5 rounded-full' />
      </span>
      <span className='nav-highlight-text'>{title}</span>
    </span>
  )
}
