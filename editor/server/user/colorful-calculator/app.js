// ===============================
// Calculator State & DOM Caching
// ===============================
const calculator = {
    currentOperand: '',
    previousOperand: '',
    operation: null,
    overwrite: false
};

const displayCurrent = document.getElementById('current-output');
const displayPrevious = document.getElementById('previous-output');
const buttons = document.querySelectorAll('.button');

// Keyboard translation map
const keyMap = {
    'Enter': '=',
    '=': '=',
    'Backspace': '←',
    'Delete': 'C',
    'Escape': 'C',
    '+': '+',
    '-': '-',          // will be normalized to the subtraction symbol later
    '*': '×',
    'x': '×',
    'X': '×',
    '/': '÷',
    '.': '.',
    ',': '.'
};

// ===============================
// Helper Functions
// ===============================

/**
 * Formats a numeric string with commas for thousands.
 * Preserves the decimal part if present.
 * @param {string} numStr
 * @returns {string}
 */
function formatNumber(numStr) {
    if (numStr === '' || numStr === '-') return numStr;
    const [intPart, decPart] = numStr.split('.');
    const sign = intPart.startsWith('-') ? '-' : '';
    const unsignedInt = sign ? intPart.slice(1) : intPart;
    const formattedInt = Number(unsignedInt).toLocaleString('en-US');
    return decPart !== undefined ? `${sign}${formattedInt}.${decPart}` : `${sign}${formattedInt}`;
}

/**
 * Updates the calculator display.
 */
function updateDisplay() {
    displayCurrent.textContent = formatNumber(calculator.currentOperand) || '0';
    if (calculator.operation) {
        const prev = formatNumber(calculator.previousOperand);
        displayPrevious.textContent = `${prev} ${calculator.operation}`;
    } else {
        displayPrevious.textContent = '';
    }
}

/**
 * Resets the calculator to its initial state.
 */
function clear() {
    calculator.currentOperand = '';
    calculator.previousOperand = '';
    calculator.operation = null;
    calculator.overwrite = false;
}

/**
 * Deletes the last character of the current operand.
 */
function deleteLast() {
    if (calculator.overwrite) {
        calculator.currentOperand = '';
        calculator.overwrite = false;
        return;
    }
    calculator.currentOperand = calculator.currentOperand.toString().slice(0, -1);
}

/**
 * Appends a digit or decimal point to the current operand.
 * @param {string} number
 */
function appendNumber(number) {
    if (calculator.overwrite) {
        calculator.currentOperand = '';
        calculator.overwrite = false;
    }

    // Prevent multiple leading zeros like "00"
    if (number === '0' && calculator.currentOperand === '0') return;

    // Handle decimal point
    if (number === '.' && calculator.currentOperand.includes('.')) return;

    calculator.currentOperand = calculator.currentOperand.toString() + number;
}

/**
 * Sets the chosen operation.
 * @param {string} op
 */
function chooseOperation(op) {
    // Normalise subtraction symbol
    if (op === '-') op = '−';

    if (calculator.currentOperand === '' && calculator.previousOperand !== '') {
        // Change operation if nothing typed yet
        calculator.operation = op;
        return;
    }

    if (calculator.currentOperand === '') return;

    if (calculator.previousOperand !== '') {
        compute(); // chain calculations
    }

    calculator.operation = op;
    calculator.previousOperand = calculator.currentOperand;
    calculator.currentOperand = '';
}

/**
 * Performs the calculation based on the stored operation.
 */
function compute() {
    const prev = parseFloat(calculator.previousOperand);
    const current = parseFloat(calculator.currentOperand);
    if (isNaN(prev) || isNaN(current)) return;

    let result;
    switch (calculator.operation) {
        case '+':
            result = prev + current;
            break;
        case '−':
        case '-':
            result = prev - current;
            break;
        case '×':
            result = prev * current;
            break;
        case '÷':
            if (current === 0) {
                result = 'Error';
            } else {
                result = prev / current;
            }
            break;
        default:
            return;
    }

    calculator.currentOperand = result.toString();
    calculator.operation = null;
    calculator.previousOperand = '';
    calculator.overwrite = true;

    // Pulse animation on equals button
    const equalsBtn = document.getElementById('key-equals');
    if (equalsBtn) {
        equalsBtn.classList.add('animate-pulse');
        equalsBtn.addEventListener('animationend', () => {
            equalsBtn.classList.remove('animate-pulse');
        }, { once: true });
    }
}

/**
 * Toggles the sign of the current operand.
 */
function toggleSign() {
    if (calculator.currentOperand === '' || calculator.currentOperand === '0') return;
    const value = parseFloat(calculator.currentOperand);
    calculator.currentOperand = (-value).toString();
    calculator.overwrite = false;
}

// ===============================
// Button Event Listeners
// ===============================
buttons.forEach(button => {
    button.addEventListener('click', () => {
        const key = button.dataset.key;

        if (key >= '0' && key <= '9') {
            appendNumber(key);
        } else if (key === '.' || key === ',') {
            appendNumber('.');
        } else if (key === '+' || key === '-' || key === '−' || key === '×' || key === '÷') {
            chooseOperation(key);
        } else if (key === '=') {
            compute();
        } else if (key === 'C') {
            clear();
        } else if (key === '←') {
            deleteLast();
        } else if (key === '±') {
            toggleSign();
        }

        updateDisplay();
    });
});

// ===============================
// Keyboard Support
// ===============================
window.addEventListener('keydown', (e) => {
    // Allow numeric keypad keys (e.key is already the character)
    const rawKey = e.key;
    const mapped = keyMap.hasOwnProperty(rawKey) ? keyMap[rawKey] : rawKey;

    // Normalise subtraction key for button lookup
    const lookupKey = (mapped === '-') ? '−' : mapped;

    const button = document.querySelector(`button[data-key="${lookupKey}"]`);
    if (button) {
        e.preventDefault();
        button.click();
    }
});

// ===============================
// Initialization
// ===============================
clear();
updateDisplay();
document.getElementById('calculator').setAttribute('tabindex', '-1');
document.getElementById('calculator').focus();