class Calculator:
    def __init__(self):
        self.history = []

    def add(self, num1, num2):
        """Add two numbers."""
        result = num1 + num2
        self.history.append(f"Added {num1} and {num2}, result = {result}")
        return result

    def subtract(self, num1, num2):
        """Subtract two numbers."""
        result = num1 - num2
        self.history.append(f"Subtracted {num2} from {num1}, result = {result}")
        return result

    def multiply(self, num1, num2):
        """Multiply two numbers."""
        result = num1 * num2
        self.history.append(f"Multiplied {num1} and {num2}, result = {result}")
        return result

    def divide(self, num1, num2):
        """Divide two numbers."""
        if num2 == 0:
            raise ZeroDivisionError("Cannot divide by zero")
        result = num1 / num2
        self.history.append(f"Divided {num1} by {num2}, result = {result}")
        return result

    def print_history(self):
        """Print the calculator's history."""
        for entry in self.history:
            print(entry)


def get_number(prompt):
    """Get a number from the user."""
    while True:
        try:
            return float(input(prompt))
        except ValueError:
            print("Invalid input. Please enter a number.")


def get_operation():
    """Get an operation from the user."""
    while True:
        operation = input("Enter an operation (+, -, *, /): ")
        if operation in ["+", "-", "*", "/"]:
            return operation
        else:
            print("Invalid operation. Please enter +, -, *, or /.")


def main():
    calculator = Calculator()
    while True:
        print("\nCalculator Menu:")
        print("1. Perform calculation")
        print("2. Print history")
        print("3. Quit")
        choice = input("Enter your choice: ")
        if choice == "1":
            num1 = get_number("Enter the first number: ")
            operation = get_operation()
            num2 = get_number("Enter the second number: ")
            try:
                if operation == "+":
                    result = calculator.add(num1, num2)
                elif operation == "-":
                    result = calculator.subtract(num1, num2)
                elif operation == "*":
                    result = calculator.multiply(num1, num2)
                elif operation == "/":
                    result = calculator.divide(num1, num2)
                print(f"Result: {result}")
            except ZeroDivisionError as e:
                print(str(e))
        elif choice == "2":
            calculator.print_history()
        elif choice == "3":
            break
        else:
            print("Invalid choice. Please try again.")


if __name__ == "__main__":
    main()