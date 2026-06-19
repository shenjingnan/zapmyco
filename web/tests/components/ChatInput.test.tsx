import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatInput } from '../../src/components/ChatInput'
import { useChatStore } from '../../src/stores/chatStore'
import { ConfigProvider } from 'antd'

function renderWithTheme(ui: React.ReactElement) {
  return render(<ConfigProvider>{ui}</ConfigProvider>)
}

describe('ChatInput', () => {
  beforeEach(() => {
    useChatStore.setState({ status: 'idle' })
  })

  it('renders textarea and send button', () => {
    renderWithTheme(<ChatInput onSend={() => {}} />)
    expect(screen.getByPlaceholderText('输入你的指令...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /发送/i })).toBeInTheDocument()
  })

  it('calls onSend when button clicked', () => {
    const onSend = vi.fn()
    renderWithTheme(<ChatInput onSend={onSend} />)

    const textarea = screen.getByPlaceholderText('输入你的指令...')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/i }))

    expect(onSend).toHaveBeenCalledWith('hello')
  })

  it('calls onSend on Enter key', () => {
    const onSend = vi.fn()
    renderWithTheme(<ChatInput onSend={onSend} />)

    const textarea = screen.getByPlaceholderText('输入你的指令...')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('hello')
  })

  it('does not call onSend with empty text', () => {
    const onSend = vi.fn()
    renderWithTheme(<ChatInput onSend={onSend} />)

    fireEvent.click(screen.getByRole('button', { name: /发送/i }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables input and button when streaming', () => {
    useChatStore.setState({ status: 'streaming' })
    renderWithTheme(<ChatInput onSend={() => {}} />)

    expect(screen.getByPlaceholderText('输入你的指令...')).toBeDisabled()
    expect(screen.getByRole('button', { name: /发送/i })).toBeDisabled()
  })

  it('disables input when waiting for approval', () => {
    useChatStore.setState({ status: 'waiting' })
    renderWithTheme(<ChatInput onSend={() => {}} />)

    expect(screen.getByPlaceholderText('等待操作确认...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /发送/i })).toBeDisabled()
  })
})
