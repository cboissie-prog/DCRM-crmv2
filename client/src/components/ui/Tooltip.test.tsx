import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('rend la bulle avec le contenu fourni', () => {
    render(
      <Tooltip content="Entreprise Dupont & Fils SARL">
        <span className="truncate">Dupont...</span>
      </Tooltip>
    )
    expect(screen.getByText('Dupont...')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Entreprise Dupont & Fils SARL')
  })

  it("n'affiche pas de bulle si le contenu est une chaîne vide", () => {
    render(
      <Tooltip content="">
        <span>Valeur</span>
      </Tooltip>
    )
    expect(screen.getByText('Valeur')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it("n'affiche pas de bulle si le contenu est absent (undefined)", () => {
    render(
      <Tooltip>
        <span>Valeur</span>
      </Tooltip>
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it("pose aria-label sur l'enfant plutôt qu'un attribut title", () => {
    render(
      <Tooltip content="Libellé complet">
        <span>Abrégé</span>
      </Tooltip>
    )
    const child = screen.getByLabelText('Libellé complet')
    expect(child).toHaveTextContent('Abrégé')
    expect(child).not.toHaveAttribute('title')
  })
})
