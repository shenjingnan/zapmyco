import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThinkingBlock } from '../../src/components/ThinkingBlock'

describe('ThinkingBlock', () => {
  it('renders collapsed by default (U1)', () => {
    render(<ThinkingBlock content="my thinking" />)
    expect(screen.getByText('Thinking')).toBeDefined()
    expect(screen.queryByText('my thinking')).toBeNull()
  })

  it('expands on click (U2)', () => {
    render(<ThinkingBlock content="my thinking" />)
    fireEvent.click(screen.getByText('Thinking'))
    expect(screen.getByText('my thinking')).toBeDefined()
  })

  it('collapses on second click (U3)', () => {
    render(<ThinkingBlock content="my thinking" />)
    fireEvent.click(screen.getByText('Thinking'))
    expect(screen.getByText('my thinking')).toBeDefined()
    fireEvent.click(screen.getByText('Thinking'))
    expect(screen.queryByText('my thinking')).toBeNull()
  })

  it('shows streaming cursor when isStreaming (U4)', () => {
    render(<ThinkingBlock content="thinking..." isStreaming />)
    const container = screen.getByText('Thinking').closest('div')!
    expect(container.textContent).toContain('▊')
  })

  it('renders without streaming cursor (U5)', () => {
    render(<ThinkingBlock content="done" />)
    fireEvent.click(screen.getByText('Thinking'))
    expect(screen.getByText('done')).toBeDefined()
  })
})
