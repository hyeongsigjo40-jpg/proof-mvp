# Elastic Habits Notes

## Sources

- Stephen Guise, Elastic Habits product page: https://www.amazon.com/Elastic-Habits-Create-Smarter-Adapt/dp/0996435476
- Mini Habits article, choosing habit intensity: https://minihabits.com/three-ways-to-choose-your-habit-intensity-every-day-with-elastic-habits/
- Mini Habits tutorial page: https://minihabits.com/tutorials/
- Local reference PDF: `/Users/johyeongsig/Downloads/elastic_habit_tracker (1).pdf`

## Core Idea

Elastic Habits turns a rigid daily habit into flexible win conditions.

Instead of one pass/fail target, each habit has intensity levels:

- Mini: easy, should feel almost always available
- Plus: moderate, a meaningful normal win
- Elite: hard, a high-output win for strong days

The broader idea is vertical flexibility: choose the intensity that fits the day. Some versions also add lateral flexibility, where a habit can be completed through different action options.

## Tracker Pattern From The PDF

The PDF is a month scorecard:

- Days 1-31 are tracked in a grid
- Each habit row can receive Mini, Plus, or Elite marks
- Counts are separated by Mini, Plus, and Elite
- Base score formula is Mini + Plus x 2 + Elite x 3
- There is room for bonuses or extra credit
- There are notes and recap/plans areas

## Proof Adaptation

Proof should not copy the heavy gamification layer blindly because our product constraint avoids points, badges, and ranking. But the useful experience is strong:

- Chat defines the elastic levels
- Tracker shows Mini, Plus, Elite as three living options
- Daily check-ins can be answered conversationally
- The tracker updates immediately from the conversation
- Counts can be shown as simple feedback, with score as a soft private indicator only if needed

For the current UX prototype:

- Right side chat is the input surface
- Left side tracker is the live structured result
- The tracker uses Mini/Plus/Elite cards
- The month grid uses 31 cells
- Conversation can set habit, Mini/Plus/Elite actions, triggers, and today's mark
