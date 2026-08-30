'use client';

import { useState } from 'react';

type Page = 'home' | 'session';

interface HomePageProps {
  onStart: (question: string, initialOpinion: string | null) => void;
}

export default function HomePage({ onStart }: HomePageProps) {
  const [question, setQuestion] = useState('');
  const [initialOpinion, setInitialOpinion] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    onStart(question.trim(), initialOpinion.trim() || null);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-blue-600">知研</h1>
            <p className="text-sm text-gray-600">AI 问人，让观点经得起追问</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow-sm border p-8">
          <h2 className="text-xl font-semibold mb-6">开始思考</h2>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="question" className="block text-sm font-medium mb-2">
                输入你想思考的问题
              </label>
              <textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：AI是否会取代人类创造力？"
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
              />
            </div>

            <details className="mb-6">
              <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-700">
                补充我的初步看法（可选）
              </summary>
              <textarea
                value={initialOpinion}
                onChange={(e) => setInitialOpinion(e.target.value)}
                placeholder="你目前的看法是什么？"
                className="w-full p-3 border rounded-lg mt-2 focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
            </details>

            <button
              type="submit"
              disabled={!question.trim()}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              开始思考
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
