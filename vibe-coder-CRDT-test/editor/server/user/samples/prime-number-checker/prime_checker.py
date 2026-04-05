"""
prime_checker.py

A simple command‑line utility that determines whether a given integer is a prime
number. The script defines a reusable `is_prime` function and provides an
interactive prompt when run directly.

Features:
- Handles edge cases (numbers less than 2 are not prime).
- Quickly eliminates even numbers greater than 2.
- Tests divisibility only up to the square root of the candidate, checking only
  odd divisors.
- Includes type hints and inline comments for clarity.
"""

import sys
import math
from typing import Any


def is_prime(n: int) -> bool:
    """
    Determine whether an integer `n` is a prime number.

    Parameters
    ----------
    n : int
        The integer to test.

    Returns
    -------
    bool
        True if `n` is prime, False otherwise.
    """
    # Edge cases: numbers less than 2 are not prime
    if n < 2:
        return False

    # 2 is the only even prime number
    if n == 2:
        return True

    # Exclude all other even numbers
    if n % 2 == 0:
        return False

    # Only test odd divisors up to √n
    limit = int(math.isqrt(n))  # integer square root, no floating point errors
    for divisor in range(3, limit + 1, 2):
        if n % divisor == 0:
            return False

    return True


def main() -> None:
    """
    Prompt the user for an integer, validate the input, and report whether it
    is a prime number.
    """
    user_input: str = input("Enter an integer: ").strip()

    try:
        number: int = int(user_input)
    except ValueError:
        # Inform the user of the invalid input and exit with a non‑zero status
        print(f"Error: '{user_input}' is not a valid integer.")
        sys.exit(1)

    # Determine primality and display the result
    if is_prime(number):
        print(f"{number} is a prime number.")
    else:
        print(f"{number} is not a prime number.")


if __name__ == "__main__":
    main()