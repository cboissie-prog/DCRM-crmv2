import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Wrench } from 'lucide-react'
import { PageIcon } from './PageIcon'

describe('PageIcon', () => {
  it('rend l’icône dans une pastille teintée du module', () => {
    render(<PageIcon module="tickets" icon={<Wrench data-testid="icon" className="w-5 h-5" />} />)
    const icon = screen.getByTestId('icon')
    const wrapper = icon.parentElement!
    expect(wrapper.className).toContain('bg-module-tickets-50')
    expect(wrapper.className).toContain('text-module-tickets-600')
    expect(wrapper.className).toContain('rounded-xl')
  })
})
