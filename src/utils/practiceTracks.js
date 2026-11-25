const tracks = {
    sql: {
        title: 'SQL',
        questions: [
            ['An orders table contains amount values 5, NULL, and 9. What does SELECT COUNT(amount) FROM orders return?',
                ['3', '2', '14'], 1, 'COUNT(column) skips NULL. COUNT(*) would count all three rows.'],
            ['Each order has one customer_id. Which query returns the number of orders for every customer who placed an order?',
                ['SELECT customer_id, COUNT(*) FROM orders',
                    'SELECT DISTINCT customer_id FROM orders',
                    'SELECT customer_id, COUNT(*) FROM orders GROUP BY customer_id'], 2,
                'Grouping by customer_id produces one row per customer, and COUNT(*) counts orders in each group.'],
            ['How do you keep customers who have no paid orders while counting only paid orders for every customer?',
                ['LEFT JOIN orders with the paid filter in ON, then COUNT(orders.id)',
                    'LEFT JOIN orders and filter for paid orders in WHERE, then COUNT(*)',
                    'INNER JOIN paid orders, then COUNT(orders.id)'], 0,
                'Put the order filter in ON to preserve customers without matching orders. COUNT(orders.id) skips the NULL on an unmatched row.'],
        ],
    },
    python: {
        title: 'Python',
        questions: [
            ['What is the result of [n * 2 for n in [1, 2, 3, 4] if n % 2 == 0]?',
                ['[2, 4, 6, 8]', '[2, 4]', '[4, 8]'], 2, 'The condition keeps 2 and 4. The expression doubles only those two values.'],
            ['Given row = {"city": "Surat"}, how can you read a missing "state" key and get "unknown" without changing row?',
                ['row.get("state", "unknown")', 'row["state"]', 'row.setdefault("state", "unknown")'], 0,
                'dict.get returns the default for a missing key. Bracket lookup raises KeyError, while setdefault inserts the key.'],
            ['What is the value of original after running original = [1, 2]; alias = original; alias.append(3)?',
                ['[1, 2]', '[1, 2, 3]', '[3]'], 1,
                'Assignment gives both names the same list. append mutates that shared list.'],
        ],
    },
    'data-engineering': {
        title: 'Data engineering',
        questions: [
            ['A job may retry after writing a batch of events. Every event has a stable unique event_id. How do you avoid adding duplicates?',
                ['Generate new IDs on retry', 'Append every event again', 'Upsert using event_id as the unique key'], 2,
                'A retry writes the same event keys again, so existing events are updated or skipped instead of inserted as new rows.'],
            ['A pipeline reads rows through a new high-water mark. When should it persist that checkpoint?',
                ['After the destination write commits', 'As soon as the job discovers it', 'Before reading the source rows'], 0,
                'Advancing the checkpoint only after the destination commit lets a failed batch be replayed. The write should tolerate retries.'],
            ['A product feed now emits timestamps in two formats. What should the pipeline do with rows it cannot parse safely?',
                ['Silently substitute the current time', 'Quarantine those rows and surface a data-quality alert', 'Drop the affected rows silently'], 1,
                'Quarantine preserves the original record for investigation and replay. An alert makes the format change visible.'],
        ],
    },
};

function getTrackQuestions(trackId) {
    if (typeof trackId !== 'string' || !Object.hasOwn(tracks, trackId)) throw new Error('Choose a practice topic.');
    const { title, questions } = tracks[trackId];
    return questions.map(([prompt, choices, correctChoice, reference], index) => ({
        id: `${trackId}-${index + 1}`, type: 'choice', prompt, choices, correctChoice, reference,
        sourceId: trackId, sourceTitle: title,
    }));
}

module.exports = { getTrackQuestions };
