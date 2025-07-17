// Simplified Vector Database Service
class VectorDatabaseService {
  constructor() {
    this.indexName = 'youtube-learning-assistant';
    this.namespace = 'learning-history';
    this.vectors = new Map(); // In-memory storage for now
    console.log('[Vector Service] Initialized with in-memory storage');
  }

  async storeVideoContent(videoData) {
    try {
      const { videoId, title, transcriptData, topics } = videoData;
      
      // Generate simple embeddings (placeholder)
      const vectors = [];
      
      for (const segment of transcriptData) {
        const embedding = this.generateSimpleEmbedding(segment.text);
        
        vectors.push({
          id: `${videoId}_${segment.time}`,
          values: embedding,
          metadata: {
            videoId,
            title,
            topic: segment.text,
            timestamp: segment.time,
            type: 'transcript_segment'
          }
        });
      }

      // Store in memory
      vectors.forEach(vector => {
        this.vectors.set(vector.id, vector);
      });
      
      console.log(`[Vector Service] Stored ${vectors.length} vectors for video: ${videoId}`);
      return { success: true, vectorsStored: vectors.length };
    } catch (error) {
      console.error('[Vector Service] Error storing video content:', error);
      return { success: false, error: error.message };
    }
  }

  async findRelatedTopics(currentTopic, limit = 5) {
    try {
      // Simple similarity search using text matching
      const relatedTopics = [];
      const currentTopicLower = currentTopic.toLowerCase();
      
      for (const [id, vector] of this.vectors) {
        const topicLower = vector.metadata.topic.toLowerCase();
        
        // Simple similarity: check if topics share common words
        const currentWords = currentTopicLower.split(' ');
        const topicWords = topicLower.split(' ');
        const commonWords = currentWords.filter(word => 
          topicWords.includes(word) && word.length > 3
        );
        
        if (commonWords.length > 0) {
          relatedTopics.push({
            topic: vector.metadata.topic,
            videoId: vector.metadata.videoId,
            title: vector.metadata.title,
            timestamp: vector.metadata.timestamp,
            similarity: commonWords.length / Math.max(currentWords.length, topicWords.length)
          });
        }
      }
      
      // Sort by similarity and limit results
      relatedTopics.sort((a, b) => b.similarity - a.similarity);
      const limitedTopics = relatedTopics.slice(0, limit);
      
      console.log('[Vector Service] Found related topics:', limitedTopics.length);
      return limitedTopics;
    } catch (error) {
      console.error('[Vector Service] Error finding related topics:', error);
      return [];
    }
  }

  async findLearningGaps(userProfile) {
    try {
      const { watchedTopics, learningLevel, interests } = userProfile;
      
      // Simple gap detection based on interests
      const gaps = [];
      const interestWords = interests.join(' ').toLowerCase().split(' ');
      
      for (const [id, vector] of this.vectors) {
        const topicLower = vector.metadata.topic.toLowerCase();
        const topicWords = topicLower.split(' ');
        
        // Check if topic matches interests but hasn't been watched
        const matchesInterest = interestWords.some(word => 
          topicWords.includes(word) && word.length > 3
        );
        
        const notWatched = !watchedTopics.some(watched => 
          watched.videoId === vector.metadata.videoId
        );
        
        if (matchesInterest && notWatched) {
          gaps.push({
            topic: vector.metadata.topic,
            videoId: vector.metadata.videoId,
            title: vector.metadata.title,
            relevance: 0.8 // Placeholder relevance score
          });
        }
      }
      
      return gaps.slice(0, 10); // Return top 10 gaps
    } catch (error) {
      console.error('[Vector Service] Error finding learning gaps:', error);
      return [];
    }
  }

  generateSimpleEmbedding(text) {
    // Simple embedding generation (placeholder)
    // In a real implementation, this would use OpenAI's embedding API
    const words = text.toLowerCase().split(' ');
    const embedding = new Array(1536).fill(0);
    
    // Simple hash-based embedding
    words.forEach((word, index) => {
      const hash = this.simpleHash(word);
      const position = hash % 1536;
      embedding[position] = (hash % 100) / 100; // Normalize to 0-1
    });
    
    return embedding;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  async getUserLearningHistory(userId) {
    try {
      const history = [];
      
      for (const [id, vector] of this.vectors) {
        if (vector.metadata.userId === userId) {
          history.push({
            topic: vector.metadata.topic,
            videoId: vector.metadata.videoId,
            title: vector.metadata.title,
            timestamp: vector.metadata.timestamp,
            watchedAt: vector.metadata.watchedAt
          });
        }
      }
      
      return history;
    } catch (error) {
      console.error('[Vector Service] Error getting learning history:', error);
      return [];
    }
  }

  async deleteVideoContent(videoId) {
    try {
      let deletedCount = 0;
      
      for (const [id, vector] of this.vectors) {
        if (vector.metadata.videoId === videoId) {
          this.vectors.delete(id);
          deletedCount++;
        }
      }
      
      console.log(`[Vector Service] Deleted ${deletedCount} vectors for video: ${videoId}`);
      return { success: true, deletedCount };
    } catch (error) {
      console.error('[Vector Service] Error deleting video content:', error);
      return { success: false, error: error.message };
    }
  }

  // Get statistics about stored data
  getStats() {
    const totalVectors = this.vectors.size;
    const uniqueVideos = new Set();
    const uniqueTopics = new Set();
    
    for (const [id, vector] of this.vectors) {
      uniqueVideos.add(vector.metadata.videoId);
      uniqueTopics.add(vector.metadata.topic);
    }
    
    return {
      totalVectors,
      uniqueVideos: uniqueVideos.size,
      uniqueTopics: uniqueTopics.size
    };
  }
}

// Export singleton instance
export const vectorService = new VectorDatabaseService(); 