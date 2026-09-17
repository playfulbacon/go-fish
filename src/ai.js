/**
 * What the computer players are allowed to know.
 *
 * Nothing here ever peeks at a hand. Knowledge is rebuilt from the public
 * event log -- the same information a human sitting at the table would have
 * from listening to the asks and watching the cards change hands.
 *
 * knowledge[playerIndex][rank] === true  -> they are known to hold it
 * knowledge[playerIndex][rank] === false -> they are known not to hold it
 * undefined -> unknown
 */
export class Memory {
  constructor(playerCount) {
    this.knowledge = Array.from({ length: playerCount }, () => Object.create(null));
  }

  observe(event) {
    const k = this.knowledge;
    switch (event.type) {
      case 'ask':
        // You may only ask for what you hold, so the ask itself is a tell.
        k[event.player][event.rank] = true;
        break;
      case 'gofish':
        k[event.player][event.rank] = false;
        break;
      case 'give':
        k[event.from][event.rank] = false;
        k[event.to][event.rank] = true;
        break;
      case 'draw':
        if (event.lucky) k[event.player][event.asked] = true;
        // An unseen draw makes every "known to be missing" note unreliable for
        // that player, since they might have just picked the card up.
        else this.#forgetNegatives(event.player);
        break;
      case 'refill':
        this.#forgetNegatives(event.player);
        break;
      case 'book':
        // All copies of the rank are off the table now.
        for (const player of k) player[event.rank] = false;
        break;
      default:
        break;
    }
  }

  #forgetNegatives(playerIndex) {
    const player = this.knowledge[playerIndex];
    for (const rank of Object.keys(player)) {
      if (player[rank] === false) delete player[rank];
    }
  }
}
