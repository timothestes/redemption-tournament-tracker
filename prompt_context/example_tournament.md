## Here's an example tournament I'd like you to try and test:

### Tournament Structure

5 players are participating in a Redemption tournament. The tournament will last 3 rounds.

Player names:

- Player 1
- Player 2
- Player 3
- Player 4
- Player 5

### Tournament Scoring

Each player will always score the number of round points associated with their player number. For example, Player 5 will always score 5 points, Player 4 will always score 4 points, and so on. At the end of the tournament, the player with the most match points wins. Since player 5 will always win every round they play, we can expect them to win every time.

Since there are an odd number of players, one of them will always get a bye and automatically get 3 match points. The player who gets the bye should be the player with the lowest number of match points. If there is a tie, the player with the lowest differential should get the bye. If its a tie between differential AND match points, assign the player with a bye at random.

**Note**: Its possible for a player to get a bye more than once.

### What to check

- At the end of the tournament Player 5 should always have 9 match points (3 full wins)
- Player 5 should NOT get a bye on round 3 (if the player does, explain to me why)

So far in my testing, Player 5 ends up with 8 points and sometimes gets a bye in round 3. These are unexpected results and should be remedied.