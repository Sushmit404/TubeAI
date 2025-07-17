// Enhanced AI Service with better prompting
class AdvancedAIService {
  constructor() {
    this.openaiApiKey = ''; // Add your OpenAI API key here
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.responseTimes = []; // Array to store response times for averaging
  }

  async generateComprehensiveHelp(topic, context) {
    try {
      console.log('[AI Service] Generating comprehensive help for topic:', topic);
      
      const { currentTime, watchTime, replayCount, learningLevel, previousTopics } = context;
      
      // Create enhanced prompts for better responses
      const explanationPrompt = this.createExplanationPrompt(topic, context);
      const quizPrompt = this.createQuizPrompt(topic, context);
      const learningPathPrompt = this.createLearningPathPrompt(topic, context);

      // Generate all responses in parallel
      const [explanationResponse, quizResponse, learningPathResponse] = await Promise.all([
        this.makeOpenAIRequest(explanationPrompt),
        this.makeOpenAIRequest(quizPrompt),
        this.makeOpenAIRequest(learningPathPrompt)
      ]);

      return {
        success: true,
        explanation: explanationResponse,
        quiz: this.parseQuiz(quizResponse),
        learningPath: learningPathResponse,
        topic,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('[AI Service] Error generating help:', error);
      return {
        success: false,
        error: error.message,
        topic
      };
    }
  }

  createExplanationPrompt(topic, context) {
    const { currentTime, watchTime, replayCount, learningLevel } = context;
    
    return `You are an expert educational assistant. When a student pauses a YouTube video, provide a comprehensive explanation.

CONTEXT:
- Topic: ${topic}
- Video Time: ${currentTime?.toFixed(1) || 0} seconds
- User has watched this topic for ${watchTime?.toFixed(1) || 0} seconds
- User has replayed this topic ${replayCount || 0} times
- Learning Level: ${learningLevel || 'beginner'}

TASK:
Provide a ${learningLevel || 'beginner'}-friendly explanation that includes:
1. Core concept breakdown
2. Real-world examples
3. Common misconceptions to avoid
4. Visual analogies (if applicable)
5. Key takeaways

EXPLANATION:`;
  }

  createQuizPrompt(topic, context) {
    const { learningLevel } = context;
    
    return `Create an engaging quiz question based on this topic: ${topic}

REQUIREMENTS:
- Question should test understanding, not memorization
- Include 4 multiple-choice options (A, B, C, D)
- Provide clear explanation for the correct answer
- Make it challenging but fair for ${learningLevel || 'beginner'} level

QUIZ FORMAT:
Question: [Your question here]

A) [Option A]
B) [Option B] 
C) [Option C]
D) [Option D]

Correct Answer: [Letter]
Explanation: [Why this is correct]`;
  }

  createLearningPathPrompt(topic, context) {
    const { watchTime, replayCount, learningLevel, previousTopics } = context;
    
    return `Based on the user's learning behavior, suggest the next learning steps.

USER CONTEXT:
- Current Topic: ${topic}
- Time Spent: ${watchTime?.toFixed(1) || 0} seconds
- Replay Count: ${replayCount || 0}
- Learning Level: ${learningLevel || 'beginner'}
- Previous Topics: ${previousTopics || 'None'}

SUGGEST:
1. Immediate next steps (within this video)
2. Related topics to explore
3. Practice exercises
4. Review schedule`;
    }

  async makeOpenAIRequest(prompt) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are an expert educational assistant. Provide clear, helpful, and engaging responses.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Calculate and log response time
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      console.log(`[⏱️ GPT Response Time] ${duration} ms`);
      
      // Store duration for averaging
      this.responseTimes.push(duration);
      
      // Log average response time every 10 requests
      if (this.responseTimes.length % 10 === 0) {
        const average = Math.round(this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length);
        console.log(`[📊 GPT Average Response Time] ${average} ms (${this.responseTimes.length} requests)`);
      }
      
      return data.choices[0].message.content;
    } catch (error) {
      // Log response time even for failed requests
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      console.log(`[⏱️ GPT Response Time (Failed)] ${duration} ms`);
      
      console.error('[AI Service] OpenAI request failed:', error);
      throw error;
    }
  }

  parseQuiz(quizText) {
    try {
      const lines = quizText.split('\n').filter(line => line.trim());
      
      let question = '';
      let options = {};
      let correctAnswer = '';
      let explanation = '';
      
      for (const line of lines) {
        if (line.startsWith('Question:')) {
          question = line.replace('Question:', '').trim();
        } else if (line.match(/^[A-D]\)/)) {
          const option = line.charAt(0);
          const text = line.substring(2).trim();
          options[option] = text;
        } else if (line.startsWith('Correct Answer:')) {
          correctAnswer = line.replace('Correct Answer:', '').trim();
        } else if (line.startsWith('Explanation:')) {
          explanation = line.replace('Explanation:', '').trim();
        }
      }

      return {
        question,
        options,
        correctAnswer,
        explanation
      };
    } catch (error) {
      console.error('[AI Service] Error parsing quiz:', error);
      return null;
    }
  }

  async generateEmbeddings(text) {
    // Placeholder for embedding generation
    console.log('[AI Service] Would generate embeddings for:', text.substring(0, 100) + '...');
    return [];
  }
}

// Export singleton instance
export const aiService = new AdvancedAIService(); 