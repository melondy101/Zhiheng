import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import QAPanel from '../../src/app/components/QAPanel';
import type { Message } from '../../src/lib/providers';

describe('QAPanel Loading Feedback & Timing Effects', () => {
  const dummyRef = { current: null };

  it('renders retry question button and degraded notice when usedFallback is true', () => {
    const html = renderToStaticMarkup(
      createElement(QAPanel, {
        messages: [],
        currentQuestion: '这是一个降级模板问题？',
        currentStrategy: 'M1_evidence',
        usedFallback: true,
        fallbackReason: 'timeout',
        answer: '',
        onAnswerChange: () => {},
        onSubmit: () => {},
        onRetryQuestion: () => {},
        messagesEndRef: dummyRef,
        formLoading: false,
      })
    );

    assert.ok(html.includes('AI 响应超时，已使用策略模板'), 'Should render fallback reason message');
    assert.ok(html.includes('重新请求 AI'), 'Should render retry question button');
  });

  it('renders loading indicators on send button during formLoading', () => {
    const html = renderToStaticMarkup(
      createElement(QAPanel, {
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            text: '这是历史追问？',
            timestamp: Date.now(),
          },
        ],
        currentQuestion: null,
        currentStrategy: 'M1_evidence',
        usedFallback: false,
        answer: '我的思考观点',
        onAnswerChange: () => {},
        onSubmit: () => {},
        messagesEndRef: dummyRef,
        formLoading: true,
      })
    );

    assert.ok(html.includes('send-answer-button'), 'Should render send button');
    assert.ok(html.includes('disabled=""') || html.includes('disabled'), 'Send button should be disabled during loading');
  });

  it('renders thinking feedback element when user answer is submitted and loading', () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        text: '我认为教育不应被技术完全替代。',
        timestamp: Date.now(),
        status: 'pending',
      },
    ];

    const html = renderToStaticMarkup(
      createElement(QAPanel, {
        messages,
        currentQuestion: null,
        currentStrategy: 'M1_evidence',
        usedFallback: false,
        answer: '',
        onAnswerChange: () => {},
        onSubmit: () => {},
        messagesEndRef: dummyRef,
        formLoading: false,
      })
    );

    assert.ok(html.includes('我认为教育不应被技术完全替代。'));
    assert.ok(html.includes('发送中...'), 'Optimistic pending message should show status');
  });
});
