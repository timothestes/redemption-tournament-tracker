# Tournament Structure

We want to implement a Swiss Style Tournament. In a Swiss style tournament, all players play out a set number of rounds. Players can drop at any time. 

## Match Points
Players earn 3 **match points** for a win, 2 **match points** for a timed win, 1.5 points for a draw and 0 **match points** for a loss.

## Game Points
In a game of Redemption, the winner is the one who gets to 5 *game points* first. These are different than **match points**. Its possible to end the round before a player has gotten all 5 points. If this is the case, its called a "timed win" for the player who is ahead in *game points*

For example, if I score 5 *game points* and you score 3 *game points*, I've earned a win and will be awared 3 **match points**. Since you lost, you'd receive 0 **match points**.

If I score 4 *game points* and you score 3 *game points*, I've earned a timed win and will be awarded 2 **match points**. (It's a timed win b/c I didn't reach to the full 5 I). Its still a loss for you and you'd receieve 0 **match points**.

If we both score 4 *game points*, we will both get 1.5 **match points**, because the game points are tied.

If I score 2 *game points* and you score 5 *game points*, I get 0 **match points** and you get 3 **match points.**


## Ranking
Your standing in the tournament is determined first by your number of match points, and then by "score differential", an internal metric calculated by keeping track of the score difference in your games, which will be explained in more detail later.


## Number of Rounds
For most normal events, the number of Swiss rounds is based on the number of players in the event. Here's how it's usually done:

5-8 Players = 3 Rounds

9-16 Players = 4 Rounds

17-32 Players = 5 Rounds

33-64 Players = 6 Rounds 

65-128 Players = 7 Rounds

129-212 Players = 8 Rounds

213-385 Players = 9 Rounds


## Pairing Logic

### Same-Opponent-Twice Restriction
A player cannot be paired against the same player twice in the Swiss rounds. 

### Pair-Downs
You are paired randomly against others players with the same number of match points, so long as the "same-opponent-twice" restriction is not broken. If there's an odd number of players with a given record, then someone will be picked randomly to be paired up or paired down. In other words, if your record is 2-1 (two wins, one loss), then you will typically be paired against another 2-1 player. Though it's not common, it's also possible to be paired up against 2-0-1 or 3-0 player, or paired down against a 1-1-1 or 1-2 player.


## Game Score Differential
During the course of a game, players can add points to their game score (which goes up to 5). The differential is simply the difference between your game score and your opponents game score in a game. If you scored 5 and your opponent scored 1 during your first round, you'd have a differntial of +4. And if you scored 2 and your opponent scored 5 in the next round, that would be a -3 differential so you'd have a total differential of +1. These can be used to determine the rankings of players with the same number of match points.

## Byes
Earning a bye means being given an automatic match win without having to play. You might be given a bye if there are an odd number of players. (After round 1, byes are usually given to players at the bottom of the standings).

