// Todo List App - Vanilla JavaScript
// --------------------------------------------------
// This script handles loading, rendering, and persisting
// tasks using localStorage. All interactions (add, toggle,
// delete) are managed without any external libraries.
// --------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
    const taskForm = document.getElementById('task-form');
    const newTaskInput = document.getElementById('new-task');
    const taskList = document.getElementById('task-list');
    const STORAGE_KEY = 'tasks';

    let tasks = [];

    // --------------------------------------------------
    // Helper: Save tasks array to localStorage
    // --------------------------------------------------
    function saveTasks() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
        } catch (e) {
            console.error('Failed to save tasks to localStorage:', e);
        }
    }

    // --------------------------------------------------
    // Helper: Load tasks from localStorage (with error handling)
    // --------------------------------------------------
    function loadTasks() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        try {
            const parsed = JSON.parse(stored);
            // Ensure it's an array of objects with expected shape
            if (Array.isArray(parsed)) {
                return parsed.map(t => ({
                    text: typeof t.text === 'string' ? t.text : '',
                    completed: !!t.completed
                }));
            }
        } catch (e) {
            console.warn('Corrupted tasks data in localStorage. Resetting.', e);
        }
        // If we get here, something went wrong – clear the bad data.
        localStorage.removeItem(STORAGE_KEY);
        return [];
    }

    // --------------------------------------------------
    // Render a single task <li> element
    // --------------------------------------------------
    function renderTask(task, index) {
        const li = document.createElement('li');
        li.className = 'task-item';
        if (task.completed) li.classList.add('completed');

        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.completed;
        checkbox.dataset.index = index;

        // Text span
        const span = document.createElement('span');
        span.className = 'task-text';
        span.textContent = task.text;

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'delete-btn';
        delBtn.dataset.index = index;
        delBtn.innerHTML = '&times;'; // multiplication sign

        // Append children
        li.appendChild(checkbox);
        li.appendChild(span);
        li.appendChild(delBtn);

        // Event: toggle completion
        checkbox.addEventListener('change', function (e) {
            const idx = Number(e.target.dataset.index);
            tasks[idx].completed = e.target.checked;
            saveTasks();
            renderTasks(); // re‑render to update .completed class
        });

        // Event: delete task
        delBtn.addEventListener('click', function (e) {
            const idx = Number(e.target.dataset.index);
            tasks.splice(idx, 1);
            saveTasks();
            renderTasks();
        });

        return li;
    }

    // --------------------------------------------------
    // Render the full task list
    // --------------------------------------------------
    function renderTasks() {
        // Clear existing list
        taskList.innerHTML = '';
        tasks.forEach((task, i) => {
            const li = renderTask(task, i);
            taskList.appendChild(li);
        });
    }

    // --------------------------------------------------
    // Form submit – add new task
    // --------------------------------------------------
    taskForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const rawValue = newTaskInput.value.trim();
        if (!rawValue) {
            // Simple user feedback – could be replaced with UI toast
            alert('Please enter a task.');
            return;
        }

        const newTask = {
            text: rawValue,
            completed: false
        };

        tasks.push(newTask);
        saveTasks();
        renderTasks();

        newTaskInput.value = '';
        newTaskInput.focus();
    });

    // --------------------------------------------------
    // Initial load
    // --------------------------------------------------
    tasks = loadTasks();
    renderTasks();
});